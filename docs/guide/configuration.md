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
