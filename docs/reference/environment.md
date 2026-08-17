# Environment variables

All configuration is by environment variable; there is no config file.

| Variable                  | Required | Type    | Default | Description                                                        |
| ------------------------- | -------- | ------- | ------- | ------------------------------------------------------------------ |
| `LINKWARDEN_URL`          | yes      | string  | —       | Base URL, e.g. `https://links.example.net`. Without `/api/v1`.     |
| `LINKWARDEN_TOKEN`        | yes      | secret  | —       | Access token from Settings → Access Tokens.                        |
| `LINKWARDEN_READ_ONLY`    | no       | boolean | `false` | `true` registers only the 11 read tools.                           |
| `LINKWARDEN_INSECURE_TLS` | no       | boolean | `false` | `true` accepts self-signed certificates, scoped to this connection. |

Booleans are compared against the literal string `true`. `True`, `1` and `yes` are off,
so a typo fails closed rather than silently disabling certificate validation.

## Validation at startup

`LINKWARDEN_URL` is parsed with `new URL`. The server **exits** when it:

- does not parse,
- uses a scheme other than `http:` or `https:`,
- contains credentials (`https://user:pw@host`).

It **warns and continues** when:

- the URL is plain `http:` to a non-loopback host (the token would be sent in clear),
- `LINKWARDEN_TOKEN` does not start with `ey` (Linkwarden tokens are NextAuth JWTs, so
  this usually means a cookie or password was pasted in),
- either required variable is missing — the server still starts and lists its tools so
  registries and inspectors can introspect it; every call then fails with setup
  instructions.

Normalisation: a trailing slash is stripped, and a `/api/v1` suffix is removed, since
the client appends the prefix itself and redirects are never followed.

## Token handling

`LINKWARDEN_TOKEN` is **deleted from the process environment** as soon as it is read —
before any branch of the parser, including the ones that exit — so it is not visible to
child processes or in `/proc/<pid>/environ`. It is never logged and never appears in an
error message.

## Not environment variables

There are no variables for timeouts, page sizes or result budgets; those are fixed:

| Limit                    | Value       |
| ------------------------ | ----------- |
| Request timeout          | 30 s        |
| Response body ceiling    | 8 MB        |
| Result budget            | 200 000 characters |
| Links per search         | 100         |
| Links per bulk operation | 200         |
| Article slice, default   | 20 000 characters |
| Confirmation token TTL   | 5 minutes   |
