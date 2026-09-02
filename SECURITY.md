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

Destructive operations **ask a person** through MCP elicitation: a dialog raised by the
server and shown by the client, which the model cannot answer on its behalf, and which
nothing proceeds without. Where the client cannot show one they fall back to a
server-generated token bound to the specific target, which proves the call was made
twice with the same arguments and nothing more; the fallback text says so rather than
implying somebody approved. `ELICITATION=false` moves a capable client onto it
deliberately — it does not remove the guard, and the server prints one line at startup
saying it is off.

Data returned from the upstream API is untrusted input: it is marked as such, and
confirmation prompts never quote it.

## Bookmarking a URL is a server-side fetch

`create_link`, `update_link` and `create_rss_subscription` hand a URL to **Linkwarden**,
which opens it in its headless-browser preserver or fetches the feed immediately. The
request therefore originates inside Linkwarden's network, and `get_link_content` reads
the preserved text back out — so an unchecked URL is not merely an outbound request, it
is one whose response returns to the caller. That is reachable from text inside a page
the account has already saved.

Loopback and link-local addresses are refused, which covers `169.254.169.254` and
anything on the Linkwarden host's own loopback, together with the metadata service's
hostnames (`metadata.google.internal`, `instance-data` and their siblings), which
resolve only on the instance itself. Addresses are classified numerically rather than
by comparing strings, because `URL` rewrites an IPv4-mapped IPv6 literal before any
check sees it: `http://[::ffff:169.254.169.254]/` arrives as `[::ffff:a9fe:a9fe]` and a
dual-stack client dials it as plain `169.254.169.254`. What is sent to Linkwarden is the
parsed URL rather than the string that came in, so the address that was checked is the
one fetched — `http://ok.example.com\@127.0.0.1/` has the host `ok.example.com` for a
URL parser and `127.0.0.1` for a fetcher that splits at the `@`.

Private LAN ranges (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`) stay allowed on
purpose. Bookmarking the router's web interface, a NAS or an intranet page is a normal
thing to do with a self-hosted bookmark manager. Be clear about what that permits,
though: if Linkwarden runs from the project's own `docker-compose.yml`, its `postgres`
and `meilisearch` containers sit on the same bridge network and answer to their service
names, so `http://meilisearch:7700/indexes` is a URL this server will accept. Names that
only resolve inside a network — compose service names, `.internal`, `.svc`,
`.local` — cannot be recognised from here at all, because they resolve to nothing on
this machine. If that matters to you, keep Linkwarden's egress restricted where it runs.

Four things this does not cover, and cannot:

- A hostname is resolved here and resolved again by Linkwarden when it fetches. A
  record that changes in between is outside what any client-side check can see. Worse,
  a name that does not resolve here within three seconds is passed on rather than
  refused — the Linkwarden server may sit in a different network with its own resolver,
  but it also means whoever is authoritative for a name can switch the DNS half off
  simply by answering slowly. Treat it as a barrier against the easy case.
- Redirects and anything the headless browser loads from the page it was given are
  URLs this server never saw.
- **The entries inside a feed are not the feed URL.** `create_rss_subscription` checks
  the address of the feed; Linkwarden then creates and preserves a link for every
  `<item><link>` the feed contains. Before Linkwarden 2.14 those addresses are not
  checked by anything, so an attacker-controlled feed listing
  `http://169.254.169.254/latest/meta-data/…` reaches exactly the primitive this guard
  exists to close, one hop further along. Do not subscribe to feeds you do not trust,
  and prefer Linkwarden 2.14 or later, which validates them itself.
- `represerve_link` re-archives a URL Linkwarden already holds. It is not re-checked:
  the URL either came through this server and was checked then, or it came from
  Linkwarden itself, where this server has no say. On an instance whose stored links
  predate this guard, that does mean it can refresh a stale internal read rather than
  merely re-expose an old one. Its confirmation dialog therefore names the **host**
  the re-archive will fetch — only the host, since the path and the title are prose
  from a foreign page.

Finally, the check itself makes a DNS query from the machine running this server for
every hostname a caller supplies — before any request reaches Linkwarden. That is a
small outbound side channel that did not exist before, and it is visible to whoever
runs the resolver.

Where Linkwarden itself sits on the network is the boundary that actually holds. If it
runs somewhere that can reach a metadata service or an unauthenticated admin port, put
that out of its reach there rather than relying on this check.

## What the confirmation proves

Both confirmation paths bind an answer to **one operation with one set of arguments**:
the two-call `confirm_token` through a one-use entry in the store, the elicitation reply
through a sealed (HMAC) `requestState` carrying the resource key. Neither proves the
answer is _recent_. A sealed state that opens onto an operation opens onto it whenever
it is replayed.

No replay defence is built, because in this deployment shape there is nothing to replay:

- The sealing key is 32 random bytes per process, and this is a stdio server spawned per
  session, so a state sealed in one session cannot be opened in the next.
- `requestState` only crosses the wire on protocol revision `2026-07-28`. This server
  does not set `supportedProtocolVersions`, so it takes the SDK's default list, which
  ends at `2025-11-25`; on that revision the SDK bridges the elicitation server-side and
  the value never leaves the process.
- The `confirm_token` path is single-use and expires after five minutes.

If any of those changes — a negotiated `2026-07-28`, or two processes serving the two
halves of one flow with a shared key — a nonce becomes necessary. The approvals worth
stealing here are `delete_link`, `bulk_delete_links` and `delete_collection`.
