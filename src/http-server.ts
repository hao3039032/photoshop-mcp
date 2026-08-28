import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from 'node:http';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PhotoshopMCPServer } from './core/server.js';
import { shutdownUxpBridgeServer } from './platform/uxp-bridge-server.js';
import { Logger } from './utils/logger.js';

export const HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 38451;
export const HTTP_PATH = '/mcp';
const MAX_BODY_BYTES = 1024 * 1024;

export interface PhotoshopHttpServerConfig {
  port: number;
  serverVersion: string;
  allowedOrigins?: readonly string[];
}

export interface RunningPhotoshopHttpServer {
  host: string;
  port: number;
  path: string;
  url: string;
  close(): Promise<void>;
}

interface SessionRecord {
  transport: StreamableHTTPServerTransport;
  mcpServer: PhotoshopMCPServer;
}

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendMcpError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, {
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  });
}

function requestOrigin(req: IncomingMessage): string | undefined {
  const value = req.headers.origin;
  return Array.isArray(value) ? value[0] : value;
}

function applyBrowserAccessHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: ReadonlySet<string>
): boolean {
  const origin = requestOrigin(req);
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.setHeader('Vary', 'Origin');
  return true;
}

function sendCorsPreflight(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Accept',
      'Authorization',
      'Content-Type',
      'Last-Event-ID',
      'Mcp-Method',
      'Mcp-Name',
      'Mcp-Protocol-Version',
      'Mcp-Session-Id',
    ].join(', ')
  );
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  res.writeHead(204);
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpRequestError(413, 'Request body is too large');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new HttpRequestError(413, 'Request body is too large');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpRequestError(400, 'Request body is required');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpRequestError(400, 'Request body must be valid JSON');
  }
}

function closeHttpServer(server: NodeHttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

export async function startPhotoshopHttpServer(
  config: PhotoshopHttpServerConfig
): Promise<RunningPhotoshopHttpServer> {
  const logger = new Logger('StreamableHTTP');
  const sessions = new Map<string, SessionRecord>();
  const allowedOrigins = new Set(config.allowedOrigins ?? []);
  let actualPort = config.port;
  let shuttingDown = false;

  const cleanupSession = async (sessionId: string): Promise<void> => {
    const record = sessions.get(sessionId);
    if (!record) return;
    sessions.delete(sessionId);
    await record.mcpServer.stop();
    logger.info(`Closed MCP session ${sessionId}`);
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const allowedHosts = new Set([`${HTTP_HOST}:${actualPort}`, `localhost:${actualPort}`]);
    if (!req.headers.host || !allowedHosts.has(req.headers.host)) {
      sendJson(res, 403, { error: 'invalid_host' });
      return;
    }
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (!applyBrowserAccessHeaders(req, res, allowedOrigins)) {
      sendJson(res, 403, { error: 'invalid_origin' });
      return;
    }

    if (requestUrl.pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, transport: 'streamable-http', sessions: sessions.size });
      return;
    }

    if (requestUrl.pathname !== HTTP_PATH) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    if (req.method === 'OPTIONS') {
      if (!requestOrigin(req)) {
        sendJson(res, 400, { error: 'origin_required' });
        return;
      }
      sendCorsPreflight(req, res);
      return;
    }

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const existing = sessionId ? sessions.get(sessionId) : undefined;
        if (existing) {
          await existing.transport.handleRequest(req, res, body);
          return;
        }

        if (sessionId) {
          sendMcpError(res, 404, 'Session not found');
          return;
        }
        if (!isInitializeRequest(body)) {
          sendMcpError(res, 400, 'An initialize request is required for a new session');
          return;
        }

        const mcpServer = new PhotoshopMCPServer({ serverVersion: config.serverVersion });
        let initializedSessionId: string | undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          keepAliveMs: 15_000,
          onsessioninitialized: (newSessionId) => {
            initializedSessionId = newSessionId;
            sessions.set(newSessionId, { transport, mcpServer });
            logger.info(`Opened MCP session ${newSessionId}`);
          },
          onsessionclosed: cleanupSession,
        });
        transport.onclose = () => {
          const closingSessionId = transport.sessionId ?? initializedSessionId;
          if (closingSessionId) void cleanupSession(closingSessionId);
        };

        try {
          await mcpServer.connect(transport, 'Streamable HTTP');
          await transport.handleRequest(req, res, body);
        } catch (error) {
          await transport.close().catch(() => undefined);
          await mcpServer.stop().catch(() => undefined);
          throw error;
        }
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sessionId) {
          sendMcpError(res, 400, 'Mcp-Session-Id header is required');
          return;
        }
        const existing = sessions.get(sessionId);
        if (!existing) {
          sendMcpError(res, 404, 'Session not found');
          return;
        }
        await existing.transport.handleRequest(req, res);
        return;
      }

      res.setHeader('Allow', 'GET, POST, DELETE');
      sendJson(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      logger.error('HTTP request failed:', error);
      if (!res.headersSent) {
        const status = error instanceof HttpRequestError ? error.status : 500;
        const message = error instanceof HttpRequestError ? error.message : 'Internal server error';
        sendMcpError(res, status, message);
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once('error', onError);
    httpServer.listen(config.port, HTTP_HOST, () => {
      httpServer.off('error', onError);
      const address = httpServer.address();
      if (address && typeof address === 'object') actualPort = address.port;
      resolve();
    });
  });

  const close = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeHttpServer(httpServer);
    const activeSessions = [...sessions.entries()];
    sessions.clear();
    await Promise.allSettled(
      activeSessions.map(async ([, record]) => {
        await record.transport.close();
        await record.mcpServer.stop();
      })
    );
    await shutdownUxpBridgeServer();
  };

  const url = `http://${HTTP_HOST}:${actualPort}${HTTP_PATH}`;
  logger.info(`Photoshop MCP Streamable HTTP endpoint: ${url}`);
  return { host: HTTP_HOST, port: actualPort, path: HTTP_PATH, url, close };
}
