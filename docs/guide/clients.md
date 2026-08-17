# Connecting clients

The server speaks stdio. Every client below starts it as a child process and talks over
its stdin/stdout, so there is no port to open and nothing to expose.

## Claude Code

```sh
claude mcp add linkwarden \
  -e LINKWARDEN_URL=https://links.example.net \
  -e LINKWARDEN_TOKEN=… \
  -- npx -y linkwarden-mcp
```

Read-only:

```sh
claude mcp add linkwarden \
  -e LINKWARDEN_URL=https://links.example.net \
  -e LINKWARDEN_TOKEN=… \
  -e LINKWARDEN_READ_ONLY=true \
  -- npx -y linkwarden-mcp
```

Check it with `claude mcp list`.

## Claude Desktop

`claude_desktop_config.json` — macOS:
`~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`.

```json
{
  "mcpServers": {
    "linkwarden": {
      "command": "npx",
      "args": ["-y", "linkwarden-mcp"],
      "env": {
        "LINKWARDEN_URL": "https://links.example.net",
        "LINKWARDEN_TOKEN": "…"
      }
    }
  }
}
```

Restart Claude Desktop afterwards; it only reads the file at startup.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.linkwarden]
command = "npx"
args = ["-y", "linkwarden-mcp"]
env = { LINKWARDEN_URL = "https://links.example.net", LINKWARDEN_TOKEN = "…" }
```

## MCP Inspector

Useful for seeing the raw tool schemas and results:

```sh
LINKWARDEN_URL=https://links.example.net LINKWARDEN_TOKEN=… \
  npx @modelcontextprotocol/inspector npx -y linkwarden-mcp
```

## Docker

```sh
docker run --rm -i \
  -e LINKWARDEN_URL=https://links.example.net \
  -e LINKWARDEN_TOKEN=… \
  ghcr.io/ni-c/linkwarden-mcp:latest
```

`-i` is required — without it the container gets no stdin and the handshake never
completes. Images are published for `linux/amd64` and `linux/arm64` with an SBOM and
build provenance.

In a client config:

```json
{
  "mcpServers": {
    "linkwarden": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "LINKWARDEN_URL",
        "-e", "LINKWARDEN_TOKEN",
        "ghcr.io/ni-c/linkwarden-mcp:latest"
      ],
      "env": {
        "LINKWARDEN_URL": "https://links.example.net",
        "LINKWARDEN_TOKEN": "…"
      }
    }
  }
}
```

Passing `-e NAME` without a value forwards the variable from the client's environment
instead of baking the token into the argument list, where it would show up in `ps`.

## From source

```sh
git clone https://github.com/ni-c/linkwarden-mcp.git && cd linkwarden-mcp
npm install && npm run build
LINKWARDEN_URL=https://links.example.net LINKWARDEN_TOKEN=… node dist/index.js
```

## Pinning a version

`npx -y linkwarden-mcp` resolves to the newest release each time it starts. To pin:

```sh
npx -y linkwarden-mcp@0.1.1
```

or use the matching container tag. Releases follow semantic versioning and every one is
published with npm provenance, so the package can be traced back to the workflow run
that built it.
