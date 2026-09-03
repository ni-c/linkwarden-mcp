# Environment variables

All configuration is by environment variable; there is no config file.

| Variable                  | Required | Type    | Default | Description                                                        |
| ------------------------- | -------- | ------- | ------- | ------------------------------------------------------------------ |
| `LINKWARDEN_URL`          | yes      | string  | —       | Base URL, e.g. `https://links.example.net`. Without `/api/v1`.     |
| `LINKWARDEN_TOKEN`        | yes      | secret  | —       | Access token from Settings → Access Tokens.                        |
| `LINKWARDEN_READ_ONLY`    | no       | boolean | `false` | `true` registers only the 11 read tools.                           |
| `LINKWARDEN_ALLOW_TOOLS`  | no       | string  | —       | Tool names, `list_*` prefixes or `essential`; only these register. |
| `LINKWARDEN_DENY_TOOLS`   | no       | string  | —       | Same syntax; subtracted from whatever the allow list left.         |
| `LINKWARDEN_INSECURE_TLS` | no       | boolean | `false` | `true` accepts self-signed certificates, scoped to this connection. |
| `ELICITATION`             | no       | boolean | `true`  | `false` replaces the approval dialog with the two-call token. **Not prefixed.** |

Booleans are compared against the literal string `true`. `True`, `1` and `yes` are off,
so a typo fails closed rather than silently disabling certificate validation.

## Narrowing the tool list

`LINKWARDEN_ALLOW_TOOLS` and `LINKWARDEN_DENY_TOOLS` are comma-separated. Each entry is
either an exact tool name or a prefix with a single trailing `*`:

| Value                     | Registers                                                           |
| ------------------------- | ------------------------------------------------------------------- |
| `essential`               | the curated eight, marked in the [tool reference](/reference/tools) |
| `search_links,get_link`   | exactly those two                                                   |
| `list_*`                  | `list_collections`, `list_rss_subscriptions`, `list_tags`           |
| `essential,get_dashboard` | the preset plus one more                                            |
| `*`                       | everything — the same as leaving it unset                           |

Entries are trimmed and matched case-insensitively; empty entries are ignored, and a
value that is empty or only whitespace counts as unset — `LINKWARDEN_ALLOW_TOOLS=` in a
compose file does not mean "allow nothing". `essential` is recognised only in the allow
list.

**An entry that matches no tool aborts startup**, naming the entry and listing the
valid names, as does a malformed pattern such as `*_link` or `list_*_x`. The
alternative — ignoring the entry — leaves a tool missing from `tools/list` with nothing
pointing at the cause. If both lists together remove everything, the server refuses to
start rather than offering an empty tool list.

Under `LINKWARDEN_READ_ONLY`, an exact write-tool name in the allow list is an error
naming the read-only setting rather than "unknown tool"; a pattern covering write tools
is accepted and merely contributes nothing, with a warning on stderr. Deny entries are
exempt: denying an already-suppressed tool is how a defensive list is written.

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

## `ELICITATION`

Whether a client that *can* show a dialog is asked before a guarded tool acts.
`false` takes the two-call-token path instead — it does not remove the guard, and a
server started with it off prints one line saying so.

Two ways it differs from every other variable here:

- **No prefix.** One `export ELICITATION=false` reaches every MCP server in the same
  environment, not just this one. That is the point of it and also its risk; see
  [Asking a person](/guide/approval).
- **Fatal on anything else.** Where the `LINKWARDEN_*` booleans fail *off* on a typo,
  this one stops the server with exit code 1. It is the only variable here that
  defaults to *on*, and a typo that fell back would leave the dialog running while
  you believed it was off.

Values are trimmed and matched case-insensitively. It is read *after*
`LINKWARDEN_TOKEN` is deleted from `process.env`, so the fatal path cannot leave the
token sitting there for a crash reporter.
