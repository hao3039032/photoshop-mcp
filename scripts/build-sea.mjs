import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { build } from 'esbuild';
import getPort from 'get-port';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const packageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
const buildDir = join(rootDir, 'build', 'sea');
const artifactsDir = join(rootDir, 'artifacts');
const platformName =
  platform() === 'darwin' ? 'macos' : platform() === 'win32' ? 'windows' : platform();
const archName = arch() === 'arm64' ? 'arm64' : arch() === 'x64' ? 'x64' : arch();
const extension = platform() === 'win32' ? '.exe' : '';
const executableName = `photoshop-mcp-${platformName}-${archName}${extension}`;
const executablePath = join(artifactsDir, executableName);
const bundlePath = join(buildDir, 'photoshop-mcp.cjs');
const blobPath = join(buildDir, 'photoshop-mcp.blob');
const seaConfigPath = join(buildDir, 'sea-config.json');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

const executableEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string')
);
executableEnv.ANALYTICS_DISABLED = '1';
executableEnv.LOG_LEVEL = '3';

async function assertPhotoshopTools(client, transportName) {
  const result = await client.listTools();
  if (!result.tools.some((tool) => tool.name === 'photoshop_ping') || result.tools.length < 50) {
    throw new Error(`${transportName} executable smoke test returned an invalid tool list`);
  }
  process.stdout.write(`${transportName} smoke test passed (${result.tools.length} tools)\n`);
}

async function smokeTestStdio() {
  const client = new Client({ name: 'sea-stdio-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: executablePath,
    env: executableEnv,
  });
  await client.connect(transport);
  try {
    await assertPhotoshopTools(client, 'stdio');
  } finally {
    await client.close();
  }
}

async function smokeTestHttp() {
  const port = await getPort();
  const child = spawn(executablePath, [`--http=${port}`], {
    cwd: rootDir,
    env: executableEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const ready = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error(`HTTP executable did not start in time: ${stderr}`)),
      10_000
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (chunk.includes('Photoshop MCP ready at')) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`HTTP executable exited early with ${code}: ${stderr}`));
    });
  });

  try {
    await ready;
    const client = new Client({ name: 'sea-http-smoke', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))
    );
    try {
      await assertPhotoshopTools(client, 'Streamable HTTP');
    } finally {
      await client.close();
    }
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
  }
}

await rm(buildDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });
await mkdir(artifactsDir, { recursive: true });

await build({
  entryPoints: [join(rootDir, 'src', 'index.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  minify: false,
  define: {
    __PHOTOSHOP_MCP_VERSION__: JSON.stringify(packageJson.version),
  },
});

await writeFile(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2
  )
);

run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
await copyFile(process.execPath, executablePath);

if (platform() === 'darwin') {
  run('codesign', ['--remove-signature', executablePath]);
}

const postjectCli = join(rootDir, 'node_modules', 'postject', 'dist', 'cli.js');
const postjectArgs = [
  postjectCli,
  executablePath,
  'NODE_SEA_BLOB',
  blobPath,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (platform() === 'darwin') {
  postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}
run(process.execPath, postjectArgs);

if (platform() === 'darwin') {
  run('codesign', ['--sign', '-', executablePath]);
}

run(executablePath, ['--version']);
run(executablePath, ['--help']);
await smokeTestStdio();
await smokeTestHttp();
process.stdout.write(`Created ${executablePath}\n`);
