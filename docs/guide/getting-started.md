# Getting started

## Requirements

- **Node.js 22 or newer** (24 recommended — both are current LTS lines)
- **A running Linkwarden instance.** Developed and verified against **v2.16.0**.
- **An access token**

## 1. Create a token

In Linkwarden: **Settings → Access Tokens → New Access Token**. Give it a name and,
if you like, an expiry. Copy the value immediately — Linkwarden shows it once.

::: danger A token is the whole account
Linkwarden has no per-token scopes. The token can do everything the account that
created it can do, including deleting collections and reading every link that account
can see.

Create a **dedicated user** and share only the collections this server should reach
with it. Do not use your admin account's token.
:::

## 2. Point the server at your instance

Two variables are required:

```sh
export LINKWARDEN_URL=https://links.example.net   # no /api/v1 suffix
export LINKWARDEN_TOKEN=eyJ…
```

Use `https://`. Over plain http the token travels unencrypted, and the server prints a
warning unless the host is loopback. The full list is in
[Configuration](/guide/configuration).

## 3. Run it

The server speaks stdio, so you normally never start it by hand — your MCP client
does. To check the wiring:

```sh
npx -y linkwarden-mcp
```

It prints a line to stderr and then waits for an MCP handshake on stdin. That is
correct behaviour, not a hang; press `Ctrl-C`.

::: tip It starts without credentials on purpose
With no token configured the server still completes the handshake and lists its tools,
so registries and sandbox inspectors can introspect it. Every *call* then fails with
setup instructions instead of reaching the API.
:::

## 4. Connect a client

```sh
claude mcp add linkwarden \
  -e LINKWARDEN_URL=https://links.example.net \
  -e LINKWARDEN_TOKEN=… \
  -- npx -y linkwarden-mcp
```

Claude Desktop, Codex and Docker are covered in
[Connecting clients](/guide/clients).

## 5. Check it works

Ask the assistant to call `get_current_user`. It is the cheapest round trip that proves
URL, token and network are all correct, and it comes back with the account name and its
archival defaults:

```json
{
  "id": 1,
  "username": "demo",
  "name": "Demo User",
  "archival_defaults": {
    "screenshot": true,
    "monolith": true,
    "pdf": true,
    "readable": true,
    "wayback_machine": false
  },
  "has_unindexed_links": true
}
```

If that fails, [FAQ & troubleshooting](/guide/faq) starts with the three
errors that account for almost everything.

## Where to go next

- Try `search_links` with a plain word, then `get_link_content` on a result — that is
  the pairing the whole server is built around.
- If search behaves oddly, read the
  [Meilisearch note](/guide/faq#why-does-search-find-nothing-useful) first. It is the
  single most common surprise.
