import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parseCliOptions } from '../src/cli-options.js';
import { startPhotoshopHttpServer, type RunningPhotoshopHttpServer } from '../src/http-server.js';

process.env.ANALYTICS_DISABLED = '1';

let running: RunningPhotoshopHttpServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('parseCliOptions', () => {
  it('uses stdio by default', () => {
    expect(parseCliOptions([], {})).toEqual({
      mode: 'stdio',
      httpPort: 38451,
      allowedOrigins: [],
      help: false,
      version: false,
    });
  });

  it('enables HTTP with its default port', () => {
    expect(parseCliOptions(['--http'], {}).mode).toBe('http');
    expect(parseCliOptions(['--http'], {}).httpPort).toBe(38451);
  });

  it('accepts both custom-port forms', () => {
    expect(parseCliOptions(['--http=4000'], {}).httpPort).toBe(4000);
    expect(parseCliOptions(['--http', '4001'], {}).httpPort).toBe(4001);
  });

  it('rejects an invalid HTTP port', () => {
    expect(() => parseCliOptions(['--http=70000'], {})).toThrow(/Invalid HTTP port/);
  });

  it('accepts exact browser origins from the CLI and environment', () => {
    const options = parseCliOptions(['--http', '--allow-origin=https://app.example.com/'], {
      PHOTOSHOP_MCP_ALLOWED_ORIGINS: 'http://localhost:3000',
    });
    expect(options.allowedOrigins).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('rejects an allowed origin containing a path', () => {
    expect(() => parseCliOptions(['--allow-origin=https://example.com/app'], {})).toThrow(
      /Invalid allowed origin/
    );
  });
});

describe('Streamable HTTP server', () => {
  it('completes an MCP initialize and lists Photoshop tools', async () => {
    running = await startPhotoshopHttpServer({
      port: 0,
      serverVersion: '1.2.3',
    });

    const client = new Client({ name: 'http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(running.url));
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'photoshop_ping')).toBe(true);
    expect(tools.tools.length).toBeGreaterThan(50);
    await client.close();
  });

  it('always binds to the fixed loopback host', async () => {
    running = await startPhotoshopHttpServer({
      port: 0,
      serverVersion: '1.2.3',
    });

    expect(running.host).toBe('127.0.0.1');
    expect(running.url).toBe(`http://127.0.0.1:${running.port}/mcp`);
  });

  it('rejects an unexpected Host header', async () => {
    running = await startPhotoshopHttpServer({ port: 0, serverVersion: '1.2.3' });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        {
          hostname: running?.host,
          port: running?.port,
          path: '/health',
          headers: { Host: 'attacker.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('answers browser preflight for an explicitly allowed origin', async () => {
    const origin = 'https://app.example.com';
    running = await startPhotoshopHttpServer({
      port: 0,
      serverVersion: '1.2.3',
      allowedOrigins: [origin],
    });

    const response = await fetch(running.url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,mcp-protocol-version',
        'Access-Control-Request-Private-Network': 'true',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('Mcp-Session-Id');
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
    expect(response.headers.get('access-control-expose-headers')).toBe('Mcp-Session-Id');
  });

  it('rejects browser requests from an origin that was not allowed', async () => {
    running = await startPhotoshopHttpServer({
      port: 0,
      serverVersion: '1.2.3',
      allowedOrigins: ['https://app.example.com'],
    });

    const response = await fetch(running.url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
