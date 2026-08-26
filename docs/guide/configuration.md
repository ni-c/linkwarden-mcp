# Configuration

Everything is configured through environment variables. There is no config file.

| Variable                  | Required | Default | Description                                                      |
| ------------------------- | -------- | ------- | ---------------------------------------------------------------- |
| `LINKWARDEN_URL`          | yes      | —       | Base URL, e.g. `https://links.example.net` — **without** `/api/v1` |
| `LINKWARDEN_TOKEN`        | yes      | —       | Access token from Settings → Access Tokens                       |
| `LINKWARDEN_READ_ONLY`    | no       | `false` | `true` registers only the 11 read tools                          |
| `LINKWARDEN_INSECURE_TLS` | no       | `false` | `true` accepts self-signed certificates, for this connection only |

The full reference with formats is in
[Environment variables](/reference/environment).

## `LINKWARDEN_URL`

The base URL of the instance. A trailing slash is stripped, and a URL that already
carries `/api/v1` is normalised — the client appends the prefix itself, and since
redirects are never followed the resulting 308 would otherwise be an opaque failure.

The server refuses to start if the URL:

- does not parse,
- uses a scheme other than `http:` or `https:`,
- contains credentials (`https://user:pw@…`) — use `LINKWARDEN_TOKEN` instead.

It warns, but continues, when the URL is plain `http:` to a non-loopback host: the
token would travel unencrypted.

## `LINKWARDEN_TOKEN`

The access token. It is **deleted from the process environment** as soon as it has been
read, so it is not visible to child processes or in `/proc/<pid>/environ`.

Linkwarden's tokens are NextAuth JWTs and start with `ey`. A value that does not gets a
warning at startup — usually it means a session cookie or a password was pasted in by
mistake, and the warning arrives before the first confusing 401.

## `LINKWARDEN_READ_ONLY`

```sh
LINKWARDEN_READ_ONLY=true
```

The 17 write tools are **not registered at all** — they do not appear in `tools/list`.
This is a stronger guarantee than refusing them at call time: a model cannot ask for a
tool it cannot see, so nothing depends on the model respecting an instruction.

Worth pairing with a Linkwarden account that only has read access to the collections it
is shared into, so the restriction holds on both ends.

## Choosing the tools that load

Read-only mode is one cut, along a line this server drew for you.
`LINKWARDEN_ALLOW_TOOLS` and `LINKWARDEN_DENY_TOOLS` let you draw your own:

```sh
LINKWARDEN_ALLOW_TOOLS=essential
LINKWARDEN_ALLOW_TOOLS=search_links,get_link_content,create_link
LINKWARDEN_DENY_TOOLS=bulk_*
```

Why bother, when all twenty-eight work: a model chooses the right tool far more
reliably from a handful than from a long list, and every tool it can see costs context
on every single request. If this is the only MCP server in a session, twenty-eight is
fine. If it is one of six, it is not.

**The syntax.** Comma-separated entries. An entry is either an exact tool name or a
prefix with a trailing `*` — `list_*` matches every tool whose name starts with
`list_`. Entries are trimmed and case-insensitive, empty ones are ignored, and an empty
value counts as unset. Nothing else is a pattern: `*_link` and `list_*_x` are rejected
rather than silently matching nothing.

**`essential`** is a curated preset of eight — save, find, read:

`search_links` · `get_link` · `get_link_content` · `list_collections` · `list_tags` ·
`create_link` · `update_link` · `delete_link`

`get_link_content` is in it because the preserved article text is the actual reason to
point a model at Linkwarden. Left out on purpose: `bulk_update_links` and
`bulk_delete_links`, which are footguns by design; the preservation-queue admin tools;
RSS subscriptions; and collection and tag CRUD. The preset is marked per tool in the
[tool reference](/reference/tools), generated from the same constant the filter reads,
so the two cannot drift.

It composes — `essential,get_dashboard` adds one back, and `LINKWARDEN_DENY_TOOLS`
takes one away.

**Both together.** `LINKWARDEN_ALLOW_TOOLS` decides what is in;
`LINKWARDEN_DENY_TOOLS` is then subtracted from the result. With only a deny list,
everything else stays.

**A name that matches nothing stops the server**, with the offending entry and the list
of real names. That is deliberate: the alternative is a tool quietly missing from
`tools/list`, and nobody traces an absence back to an environment variable. The same
applies to a pattern that matches no tool, which is what catches `delet_*`.

**With read-only mode**, the write tools are not registered at all, so naming one
explicitly in `LINKWARDEN_ALLOW_TOOLS` is an error that says so — rather than calling a
tool unknown when it plainly exists. A _pattern_ that covers write tools is fine and
simply contributes nothing, which is what makes `get_*,create_*` a usable template for
both kinds of deployment; and `LINKWARDEN_ALLOW_TOOLS=essential` narrows to the read
half of the preset.

::: tip It is the same cut, not a second one
A filtered tool is never registered, so it is absent from `tools/list` and unknown to
`tools/call` alike — exactly what `LINKWARDEN_READ_ONLY` does to a write tool. There is
no "hidden but callable" state to reason about.
:::

## `LINKWARDEN_INSECURE_TLS`

```sh
LINKWARDEN_INSECURE_TLS=true
```

Accepts self-signed certificates. This is a **scoped undici dispatcher**, not
`NODE_TLS_REJECT_UNAUTHORIZED` — certificate validation stays on for everything else in
the process.

Prefer a proper internal CA. If your instance runs on an internal domain with a private
CA, adding that CA to the trust store (or `NODE_EXTRA_CA_CERTS`) keeps validation
intact and is barely more work.

## Only the exact string `true`

All boolean flags are compared against the literal string `true`. `True`, `1` and `yes`
are all off. A typo therefore cannot silently disable certificate validation — it fails
closed.
