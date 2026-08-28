#!/usr/bin/env node

import {
  capture,
  captureMcpPageview,
  endMcpAnalyticsSession,
  ensureAnalyticsIdentity,
  getAppVersion,
  identifyAnalyticsPerson,
  onMcpClientDisconnected,
  shutdownAnalytics,
  startMcpAnalyticsSession,
} from './analytics/index.js';
import type { McpShutdownReason } from './analytics/mcp-session.js';
import { parseCliOptions } from './cli-options.js';
import { PhotoshopMCPServer } from './core/server.js';
import { startPhotoshopHttpServer } from './http-server.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('Main');

const HELP = `Photoshop MCP server

Usage:
  photoshop-mcp                 Start with stdio transport (default)
  photoshop-mcp --http         Start Streamable HTTP on port 38451
  photoshop-mcp --http=PORT    Start Streamable HTTP on a custom port
  photoshop-mcp --http PORT    Equivalent custom-port form
  photoshop-mcp --http --allow-origin=ORIGIN
                               Allow a browser app to connect

Options:
  --http[=PORT]  Enable Streamable HTTP (host is fixed to 127.0.0.1)
  --allow-origin=ORIGIN
                 Add an exact http(s) browser origin; may be repeated
  --version      Print the version
  --help         Show this help

Environment:
  PHOTOSHOP_MCP_PORT, PHOTOSHOP_MCP_ALLOWED_ORIGINS, PHOTOSHOP_PATH, LOG_LEVEL
`;

let mcpServer: PhotoshopMCPServer | null = null;
let closeHttpServer: (() => Promise<void>) | undefined;
let shuttingDown = false;

async function main() {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const version = getAppVersion();
    if (options.help) {
      process.stdout.write(HELP);
      return;
    }
    if (options.version) {
      process.stdout.write(`${version}\n`);
      return;
    }

    logger.info(`Starting Photoshop MCP Server with ${options.mode} transport...`);

    ensureAnalyticsIdentity();

    if (options.mode === 'http') {
      const running = await startPhotoshopHttpServer({
        port: options.httpPort,
        serverVersion: version,
        allowedOrigins: options.allowedOrigins,
      });
      closeHttpServer = running.close;

      identifyAnalyticsPerson({ usage_surface: 'mcp', event_source: 'mcp' });
      startMcpAnalyticsSession();
      captureMcpPageview();
      capture('mcp_http_server_started', {
        event_source: 'mcp',
        listen_port: running.port,
      });
      process.stdout.write(`Photoshop MCP ready at ${running.url}\n`);
      return;
    }

    mcpServer = new PhotoshopMCPServer({ serverVersion: version });
    await mcpServer.start();

    const photoshopVersion = await mcpServer.getPhotoshopVersion();
    identifyAnalyticsPerson({
      usage_surface: 'mcp',
      event_source: 'mcp',
      ...(photoshopVersion ? { photoshop_version: photoshopVersion } : {}),
    });

    startMcpAnalyticsSession();
    captureMcpPageview();
    capture('mcp_session_started', {
      photoshop_detected: mcpServer.isPhotoshopConnected(),
      tools_registered_count: mcpServer.getToolCount(),
      event_source: 'mcp',
    });

    logger.info('Photoshop MCP Server is running');

    process.stdin.on('end', () => {
      void handleShutdown('stdio_closed');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    capture('mcp_session_startup_failed', {
      ok: false,
      error_code: 'startup_failed',
      event_source: 'mcp',
    });
    await shutdownAnalytics();
    process.exit(1);
  }
}

async function handleShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down`);

  const reason: McpShutdownReason =
    signal === 'SIGTERM'
      ? 'sigterm'
      : signal === 'stdio_closed'
        ? 'stdio_closed'
        : signal === 'SIGINT'
          ? 'sigint'
          : 'error';

  if (mcpServer) {
    await mcpServer.stop();
    mcpServer = null;
  }
  if (closeHttpServer) {
    await closeHttpServer();
    closeHttpServer = undefined;
  }

  onMcpClientDisconnected();
  endMcpAnalyticsSession(reason);
  await shutdownAnalytics();
  process.exit(0);
}

process.on('SIGINT', () => {
  void handleShutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void handleShutdown('SIGTERM');
});

main();
