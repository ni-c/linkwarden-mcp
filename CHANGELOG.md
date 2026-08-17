# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- The release workflow extracts the section of the version being tagged with awk,
     matching "## [x.y.z]". Keep that heading shape exactly. -->

## [Unreleased]

### Added

- Initial implementation: 28 tools for Linkwarden, split into 11 read tools that are
  always registered and 17 write tools that `LINKWARDEN_READ_ONLY=true` leaves out
  entirely.
- `get_link_content` reads the article text Linkwarden extracted when it preserved a
  page, so a saved bookmark can be summarised or quoted without fetching the live site
  again. Long articles are sliced and every truncation names the follow-up call. Only
  the readable format is served — the screenshot, PDF and single-file HTML archives are
  binary or raw markup.
- `search_links` documents Linkwarden's field-filter syntax (`tag:`, `collection:`,
  `pinned:`, `before:`, `after:`, `!` for negation) in its tool description, and maps
  readable sort names onto the integer enum the API expects.
- Sort orders and archived formats are exposed as names rather than as the integers
  Linkwarden uses on the wire.

### Security

- Destructive tools require a server-generated, single-use confirmation token bound to
  the exact target, never a boolean argument. Set-valued operations bind the token to a
  sha256 fingerprint of the sorted id set, so a confirmation for `[1, 2]` cannot
  execute `[1, 2, 3]`, and `bulk_update_links` and `merge_tags` additionally bind it to
  the change itself — a confirmation for "add one tag" cannot be replayed as "replace
  all tags with nothing".
- Two non-deletions are treated as destructive because they lose data just as
  irreversibly: publishing a collection (`update_collection` with `is_public=true`)
  widens visibility to anyone with the URL, and changing a link's URL makes Linkwarden
  delete every preserved copy of the old page.
- Confirmation prompts contain only counts, ids and flags. Titles, URLs, descriptions
  and collection names come from saved pages and from other users of the instance, and
  that text is read by a model.
- Output is an explicit allowlist rather than a pass-through of Linkwarden's Prisma
  rows. This keeps `textContent` — the full article text of every link — out of list
  results, and drops the member names and avatars the collection routes include.
- Partial updates read the current record and merge before writing. Linkwarden's update
  routes are replacements: `PUT /links/{id}` applies tags with `set: []` first and
  writes `name`/`description` as `data.name || ""`, and `PUT /collections/{id}` deletes
  every membership row before recreating it from the request body. An incomplete body
  would silently strip a link's tags or a collection's collaborators.
- Mutation responses are screened instead of trusted. Several Linkwarden routes report
  failures with HTTP 200 and an error sentence in the body — `PUT /links/{id}/archive`
  answers `{"response":"Invalid URL."}` that way — and a Next.js route with no branch
  for the HTTP method used falls through to a 200 with an empty body. Both are surfaced
  as errors.
- `redirect: 'error'` on every request. Linkwarden is commonly deployed behind a
  reverse proxy that redirects http to https, so a mistyped `LINKWARDEN_URL` would
  otherwise replay the bearer token to the redirect target. A URL that already carries
  the `/api/v1` prefix is normalised rather than left to 308.
- The token is deleted from `process.env` after the configuration is read, a URL
  containing credentials or a non-http scheme exits, and a token that does not look
  like a Linkwarden JWT produces a warning before the first 401.
- `LINKWARDEN_INSECURE_TLS` is a scoped undici dispatcher, never
  `NODE_TLS_REJECT_UNAUTHORIZED`.
- Preserved article text and all bookmark metadata are returned marked as untrusted
  content.
- Error bodies are truncated at 2000 characters and HTML error pages from proxies are
  dropped entirely.
- The container image deletes the npm and corepack that ship inside `node:24-alpine`.
  The entrypoint is plain `node`, so neither is used at runtime, and the packages they
  bundle were the only source of HIGH/CRITICAL findings in the image.

[Unreleased]: https://github.com/ni-c/linkwarden-mcp/compare/main...HEAD
