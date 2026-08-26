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

## Through mcp-hub

[mcp-hub](https://mcp-hub.ni-c.de) serves many stdio MCP servers from one container
behind a single HTTPS endpoint, so linkwarden-mcp can be reached from clients that
cannot spawn a local process — ChatGPT connectors, Claude on the web, Cursor — without
a container, a hostname and an OAuth stack of its own.

Its `/config/mcp.json` uses Claude Code's format, so the entry is the one you already
have:

```json
{
  "mcpServers": {
    "linkwarden": {
      "command": "npx",
      "args": ["-y", "linkwarden-mcp"],
      "env": {
        "LINKWARDEN_URL": "https://links.example.net",
        "LINKWARDEN_TOKEN": "…",
        "LINKWARDEN_ALLOW_TOOLS": "essential"
      },
      "denyTools": ["bulk_*"]
    }
  }
}
```

`allowTools` and `denyTools` are the hub's **own** per-server filter and take exact
tool names or `list_*` prefixes — the same syntax as the two environment variables, so
a list moves between them verbatim. What does **not** move is `essential`: that preset
is a linkwarden-mcp feature and belongs in `env` as shown. `"allowTools": ["essential"]`
would be a name the hub cannot resolve.

The two compose, and it is worth knowing which does what: the server registers what
its environment variables allow, and the hub exposes what its arrays allow. Filtering
in the server is the tighter of the two — the tool is never built.

Register `https://your-host/linkwarden/mcp` as a connector and you get this server
alone. Register the hub's `/hub` endpoint instead and you reach _every_ server behind
it through six meta-tools, which is the answer worth having once you run several of
these at once.

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
