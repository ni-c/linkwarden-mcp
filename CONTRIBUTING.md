# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/linkwarden-mcp.git && cd linkwarden-mcp
npm install
npm test          # unit tests against a stubbed Linkwarden API — no instance needed
npm run build
```

## Running the integration suite

The unit tests stub the API. The integration suite spawns the built server over
stdio against a throwaway Linkwarden in Docker and calls **every tool in the
catalogue**.

```sh
npm run build     # the suite runs dist/index.js, not src/
docker compose -f test/integration/compose.yml up -d
npm run test:integration
docker compose -f test/integration/compose.yml down -v
```

The stack is deliberately complete — Postgres **and** Meilisearch — because a
Linkwarden without Meilisearch does not parse `search_links` field filters
(`tag:`, `collection:`, …) at all: it matches the whole query as one literal
substring, so a filtered search returns nothing with no error anywhere. Testing
against half a stack would prove the wrong thing.

The page and the feed the suite bookmarks are served by a container on the
compose network, so nothing here reaches the public internet.

Five things it knows that cost a session each:

- **`GET /api/v1/worker` only exists from Linkwarden 2.14.** Before that it is a
  404 whose HTML body the server correctly refuses to quote, so the result
  reads like a wrong id rather than a missing endpoint. Pinned at 2.16.2.
- **Signing in is a NextAuth credentials callback**, not a JSON endpoint. It
  answers 200 either way; only the cookie tells them apart. The token endpoint
  is 401 without it.
- **`Set-Cookie` carries only what changed**, and NextAuth sets the CSRF cookie
  and the session cookie on different responses — so replacing the whole cookie
  string with each response drops the session.
- **Search is eventually consistent.** Linkwarden indexes into Meilisearch from
  its worker, so a search issued straight after a write is answered from an
  index that does not contain it yet. An empty result is not an error, so this
  reads as "the search is broken" rather than "wait a moment".
- **Linkwarden 2.14 and later refuse an RSS feed on a private address** — "URL
  resolves to a blocked internal hostname". The fixture feed served beside it on
  the compose network is exactly what it will not accept, which is why
  `delete_rss_subscription` is the one tool the suite excuses. Both refusals are
  asserted: Linkwarden's and this server's own SSRF guard.

**26 of 28 tools run against a real instance.** The two excused ones carry
written reasons in the suite; `get_link_content` needs a finished preservation,
which means a headless browser has driven over the page.

## Expectations

- **Tests.** Behaviour changes come with a test that fails without the change. CI runs
  lint, build and the test suite on Node 22 and 24, plus a coverage gate, `npm audit`,
  CodeQL and a Trivy scan of the container image on amd64 and arm64.
- **Comments** explain constraints the code cannot show — not what the next line does.
  Linkwarden's API has several undocumented behaviours (replacement-style `PUT`
  routes, failures reported as HTTP 200); when you work around one, write down which.
- **Security-sensitive areas** (config parsing, confirmation tokens, the output
  allowlist in `src/shape.ts`, anything that builds a request URL): please describe the
  attack you are defending against, or the one your change might open, in the PR text.
- **A new write tool needs a confirmation token** if it deletes, overwrites or widens
  visibility. Bind the token to the exact target — for list-valued arguments, to a
  fingerprint of the whole list.
- **Output is an allowlist, not a pass-through.** New fields are added deliberately;
  do not return Linkwarden's rows verbatim.
- **No new runtime dependencies** without a very good reason; the small tree is a
  feature.
- Run `npm run lint` before pushing — it checks both oxlint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/linkwarden-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/linkwarden-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/linkwarden-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
