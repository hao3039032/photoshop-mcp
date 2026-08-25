import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __PHOTOSHOP_MCP_VERSION__: string | undefined;

let cachedVersion: string | undefined;

/** Package version from the repo root package.json — attached to every server-side event. */
export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;
  if (typeof __PHOTOSHOP_MCP_VERSION__ === 'string') {
    cachedVersion = __PHOTOSHOP_MCP_VERSION__;
    return cachedVersion;
  }
  try {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'package.json'
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    cachedVersion = pkg.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}
