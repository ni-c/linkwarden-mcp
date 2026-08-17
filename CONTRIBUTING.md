# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/linkwarden-mcp.git && cd linkwarden-mcp
npm install
npm test          # unit tests against a stubbed Linkwarden API — no instance needed
npm run build
```

A minimal dev environment:

```sh
# Throwaway Linkwarden, so nothing you try reaches a real bookmark collection.
docker run -d --name lw-dev -p 127.0.0.1:3199:3000 \
  -e DATABASE_URL=postgresql://postgres:dev@postgres:5432/linkwarden \
  -e NEXTAUTH_SECRET=dev -e NEXTAUTH_URL=http://127.0.0.1:3199/api/v1/auth \
  ghcr.io/linkwarden/linkwarden:latest
# Register an account at http://127.0.0.1:3199, then create a token under
# Settings -> Access Tokens.

LINKWARDEN_URL=http://127.0.0.1:3199 LINKWARDEN_TOKEN=… node dist/index.js
```

Note that a Linkwarden without Meilisearch does not parse `search_links` field filters
(`tag:`, `collection:`, …) — it matches the whole query as one literal substring. That
is a property of Linkwarden, not a bug here, and `search_links` says so in its result.

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
- Run `npm run lint` before pushing — it checks both eslint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/linkwarden-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/linkwarden-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/linkwarden-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
