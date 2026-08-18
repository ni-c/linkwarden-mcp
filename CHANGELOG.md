# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- The release workflow extracts the section of the version being tagged with awk,
     matching "## [x.y.z]". Keep that heading shape exactly. -->

<!-- #region changelog -->

## [0.1.2] - 2026-08-18

### Fixed

- The architecture diagram no longer depends on the reader's operating system.
  It carried a `prefers-color-scheme` block, which resolves against the OS rather
  than the theme toggle of GitHub or npm — so dark-mode readers on a light OS got
  the light artwork on a dark page. The README now uses `<picture>`, which is
  resolved against the page, and the `<img>` that npm falls back to brings its own
  card instead of a media query.
- The README embedded the diagram and the demo GIF with repo-relative paths, which
  npm does not resolve — neither image appeared on the package page. Both are
  absolute now.

### Changed

- The diagram is generated from a single source, `docs/assets/architecture.source.svg`,
  by `npm run assets`. The four rendered copies had already drifted apart; CI now
  fails if one of them is edited by hand.
- `docs/public/og.png` is generated at exactly 1280x640, GitHub's recommended size
  for a social preview, instead of being drawn by hand.
- The demo recording is shown on the documentation home page as well, not only in
  the README, and is pinned to the content column so its width no longer depends on
  what the vhs tape happened to record.

## [0.1.1] - 2026-08-17

First release published by the automated pipeline, with npm provenance.

### Added

- Multi-arch container image on GHCR (`ghcr.io/ni-c/linkwarden-mcp`) for linux/amd64
  and linux/arm64, built with an SBOM and build provenance.
- Documentation site at <https://linkwarden-mcp.ni-c.de>, including a complete tool
  reference generated from the registered tools — CI fails when the committed
  reference no longer matches the code.
- Listed in the official MCP registry as `io.github.ni-c/linkwarden-mcp`.
- `CONTRIBUTING.md` and issue forms.

## [0.1.0] - 2026-08-17

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
  readable sort names onto the integer enum the API expects. The description states
  that those filters need Meilisearch, and a query that uses one gets a note saying so
  — Linkwarden parses field filters only in its Meilisearch branch, and without it the
  whole query is matched as a single literal substring, so `tag:news` looks for those
  nine characters and quietly finds nothing. The `collection_id`, `tag_id` and
  `pinned_only` arguments are applied by the database and work either way.
- Sort orders and archived formats are exposed as names rather than as the integers
  Linkwarden uses on the wire.

### Security

- URLs handed to Linkwarden must be `http://` or `https://`. Zod's `.url()` only checks
  that the value parses, so it accepts `javascript:`, `file:`, `data:` and `ftp:` too —
  and Linkwarden opens whatever it is given in its headless-browser preserver, which
  `get_link_content` then reads back. Without the scheme check, a model acting on an
  instruction injected into a preserved page could have bookmarked
  `file:///etc/passwd` and read the result, entirely through valid tool calls.
- The access token is removed from the environment before any branch of the
  configuration parser, not only on the fully-configured path. "URL missing or
  malformed" is exactly the state in which someone attaches an inspector or trips a
  crash reporter, and the server keeps running in it.
- A malformed `LINKWARDEN_URL` is no longer echoed into the log. That branch fires
  precisely when the variable does not hold what was expected — a token pasted into the
  wrong variable would otherwise be printed verbatim.
- Oversized results drop whole items instead of slicing the serialized JSON. Slicing
  produced a document cut off mid-string and, because `notes` and `next_cursor` are
  serialized last, discarded the pagination hint first — the one piece of information
  needed to recover from the truncation.
- Per-field caps on titles, URLs and descriptions. The count limits bound how many
  records come back and the total budget bounds the whole result, but neither bounded a
  single record: one bookmark with a 200 kB description could crowd out everything else.
- Response bodies are read against an 8 MB ceiling, checked both from `content-length`
  and while streaming. The result budgets only apply once a body is already in memory.
- `bulk_update_links` reports ids and a count instead of forwarding Linkwarden's raw
  response, so it no longer bypasses the output allowlist.
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

[Unreleased]: https://github.com/ni-c/linkwarden-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/ni-c/linkwarden-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ni-c/linkwarden-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ni-c/linkwarden-mcp/releases/tag/v0.1.0

<!-- #endregion changelog -->
