import { DEFAULT_HTTP_PORT } from './http-server.js';

export interface CliOptions {
  mode: 'stdio' | 'http';
  httpPort: number;
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

export function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let mode: CliOptions['mode'] = 'stdio';
  let httpPort = parsePort(env.PHOTOSHOP_MCP_PORT ?? String(DEFAULT_HTTP_PORT));
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
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { mode, httpPort, help, version };
}
