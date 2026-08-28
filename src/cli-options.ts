import { DEFAULT_HTTP_PORT } from './http-server.js';

export interface CliOptions {
  mode: 'stdio' | 'http';
  httpPort: number;
  allowedOrigins: string[];
  help: boolean;
  version: boolean;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid HTTP port: ${value}`);
  }
  return port;
}

function parseAllowedOrigin(value: string): string {
  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid allowed origin: ${value}`);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Invalid allowed origin: ${value}`);
  }
  return parsed.origin;
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(',').map(parseAllowedOrigin);
}

export function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let mode: CliOptions['mode'] = 'stdio';
  let httpPort = parsePort(env.PHOTOSHOP_MCP_PORT ?? String(DEFAULT_HTTP_PORT));
  const allowedOrigins = parseAllowedOrigins(env.PHOTOSHOP_MCP_ALLOWED_ORIGINS);
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--http') {
      mode = 'http';
      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        httpPort = parsePort(next);
        index += 1;
      }
    } else if (arg.startsWith('--http=')) {
      mode = 'http';
      httpPort = parsePort(arg.slice('--http='.length));
    } else if (arg === '--allow-origin') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --allow-origin');
      allowedOrigins.push(parseAllowedOrigin(next));
      index += 1;
    } else if (arg.startsWith('--allow-origin=')) {
      allowedOrigins.push(parseAllowedOrigin(arg.slice('--allow-origin='.length)));
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { mode, httpPort, allowedOrigins: [...new Set(allowedOrigins)], help, version };
}
