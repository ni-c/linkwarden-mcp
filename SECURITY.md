# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/linkwarden-mcp/security/advisories/new).
Do not open a public issue for an unpatched vulnerability, and do not include real
credentials, tokens, hostnames or private configuration in a report.

You can expect an initial response within a week. Fixed vulnerabilities are published
as a new release with a note in the CHANGELOG.

## Supported versions

Only the latest release and the current `main` branch receive security fixes.

## Trust model

`LINKWARDEN_TOKEN` is a Linkwarden access token, and Linkwarden has **no per-token
scopes**: the token carries the full permissions of the account that created it. That
account can read, edit and delete every bookmark, collection and tag it owns or is a
member of, delete a collection together with all links inside it, and publish a
collection so that anyone with the URL can read it without logging in. If the account
is the instance administrator, the token also reads instance-wide preservation
statistics.

Create a dedicated Linkwarden account for this server and share only the collections
it needs, rather than using an admin token. Give the token an expiry where the
deployment allows it; tokens can be revoked at any time under Settings → Access
Tokens.

The preserved article text this server can read is the full content of every page the
account has bookmarked. Anything in that content reaches the model.

Treat every environment variable this server reads as a secret. The MCP client
process, and therefore the model driving it, sees every tool result — do not point
this server at a system whose data you would not put in a model's context.

Destructive operations require a server-generated confirmation token that is bound to
the specific target; a model cannot satisfy that gate on its own. Data returned from
the upstream API is untrusted input: it is marked as such, and confirmation prompts
never quote it.
