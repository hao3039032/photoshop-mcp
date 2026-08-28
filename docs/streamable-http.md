# Stdio, Streamable HTTP, and native executables

There is one `photoshop-mcp` entry point. With no arguments it uses stdio. Passing `--http`
exposes the same Photoshop tools and prompts over MCP Streamable HTTP, including POST responses,
a GET SSE stream, and session termination with DELETE.

## Run with Node.js

```bash
npm install
npm run build:server
node dist/index.js              # stdio (default)
node dist/index.js --http       # HTTP on port 38451
node dist/index.js --http=4000  # HTTP on a custom port
node dist/index.js --http --allow-origin=https://app.example.com
```

The default MCP endpoint is `http://127.0.0.1:38451/mcp`. Point an HTTP-capable MCP client to
that URL. For example, clients that accept JSON MCP server definitions generally use this shape:

```json
{
  "mcpServers": {
    "photoshop": {
      "url": "http://127.0.0.1:38451/mcp"
    }
  }
}
```

Exact HTTP configuration keys vary by client. The client must implement MCP Streamable HTTP;
the older HTTP+SSE transport is not served.

## Run a release executable

On Windows:

```powershell
.\photoshop-mcp-windows-x64.exe
# or: .\photoshop-mcp-windows-x64.exe --http=38451
# browser bridge:
.\photoshop-mcp-windows-x64.exe --http=38451 --allow-origin=https://app.example.com
```

On macOS Apple Silicon:

```bash
chmod +x photoshop-mcp-macos-arm64
./photoshop-mcp-macos-arm64
# or: ./photoshop-mcp-macos-arm64 --http=38451
```

Use `photoshop-mcp-macos-x64` on an Intel Mac. In every build, omitting `--http` starts stdio.

Available options:

```text
--http           Enable Streamable HTTP on port 38451
--http=PORT      Enable Streamable HTTP on a custom port
--http PORT      Equivalent custom-port form
--allow-origin=ORIGIN
                 Allow an exact browser origin; may be repeated
--version        Print the version
--help           Show help
```

`PHOTOSHOP_MCP_PORT` changes the default HTTP port. `PHOTOSHOP_MCP_ALLOWED_ORIGINS` supplies a
comma-separated browser-origin allowlist. Existing variables such as `PHOTOSHOP_PATH` and
`LOG_LEVEL` continue to work.

## Browser clients

Browsers enforce cross-origin access even though the MCP server is on the same computer. Pass
each web application's exact origin (scheme, host, and optional port) with `--allow-origin`:

```powershell
.\photoshop-mcp-windows-x64.exe --http `
  --allow-origin=https://app.example.com
```

The server responds to CORS preflight requests, exposes `Mcp-Session-Id`, and opts in to legacy
Private Network Access preflights only for an allowed origin. Requests carrying any other
`Origin` are rejected with HTTP 403. Do not allow arbitrary origins: this endpoint can control
Photoshop. Current Chrome versions also ask the user to grant the website Local Network Access;
the connection cannot proceed if that browser permission is denied.

## Fixed local binding

HTTP mode always listens on `127.0.0.1` and always uses `/mcp`. It cannot be changed to a LAN or
public binding through arguments or environment variables. The server validates both `Host` and
browser `Origin` headers to reduce DNS rebinding and cross-site request risks.

`GET /health` returns process health and the number of active MCP sessions. It intentionally
does not expose Photoshop document state.

## Build native executables

The executable is a Node.js single-executable application. esbuild first bundles the dedicated
HTTP entry point, then Node SEA and postject embed that bundle into the current platform's Node
binary.

```bash
npm install --include=dev
npm run build:server
npm run test:unit
npm run build:exe
```

The output is written to `artifacts/`. A native build must run on its target operating system.
The GitHub Actions workflow in `.github/workflows/release-executables.yml` builds:

- `photoshop-mcp-windows-x64.exe`
- `photoshop-mcp-macos-arm64`
- `photoshop-mcp-macos-x64`

Pushing a `v*` tag attaches all successful outputs to the corresponding GitHub release. A manual
workflow run keeps them as workflow artifacts.

The workflow ad-hoc signs the macOS binaries so the injected Mach-O is structurally valid. It
does not notarize macOS builds or Authenticode-sign Windows builds. Public distribution should
add an Apple Developer ID/notarization step and a Windows code-signing certificate before the
release upload.
