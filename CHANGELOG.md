# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- The release workflow extracts the section of the version being tagged with awk,
     matching "## [x.y.z]". Keep that heading shape exactly. -->

<!-- #region changelog -->

## [Unreleased]

### Added

- Every tool declares an `outputSchema` and answers with `structuredContent`
  beside the text block. A client no longer has to parse prose to use a result —
  which seven of them made unavoidable, since they answered with a sentence. The
  sentence stays, in the text block.

  The ten reading tools carry `untrusted: true` and `source: "linkwarden"` as
  fields. This server has always said so in `notes`, which is prose in a list: a
  client can read it and cannot check it. The write tools are without the
  marker — they report an id this server was given and a count it made.

### Changed

- The advertised schemas avoid spellings that are legal JSON Schema and still
  get a tool refused, or its constraint silently dropped, by some MCP clients:
  an open object now writes `"additionalProperties": true` rather than the
  empty schema `{}` zod emits for it; a value that was left untyped is declared
  as what it really is; and a nullable field is written as `anyOf` branches
  rather than `"type": ["string", "null"]`, which several clients read as a
  single type and then drop. What the tools accept and return is unchanged;
  only the way the schema says so is.

- Three refusals in `get_link_content` are error results rather than plain
  ones: no readable archive, an archive served with the wrong content type, and
  one that is not valid JSON. Each read like an answer while being the
  opposite.

- A result too large to shrink is an error rather than an envelope carrying the
  oversized document as a string. That envelope is valid JSON and no longer a
  valid _answer_: the SDK checks a result against the schema its tool declares.

- The two-call `confirm_token` prompt is an error result. What was asked for did
  not happen, which is what `isError` says. The text is unchanged and still
  carries the token.

- The integration compose file publishes Linkwarden on `LINKWARDEN_PORT`
  (default 3010) instead of a hardcoded 3010, so a workstation that already
  runs something there does not need a patched compose file. `smtp-mcp` has
  done the same for its own port for a while.

### Security

- **`update_link` and `create_rss_subscription` are `openWorldHint: true`.**
  Both hand Linkwarden an address the caller chose and have it fetch that page,
  which is the one thing `create_link` was called open-world for. They said
  `false` on the reading that their usual call fetches nothing — but that is a
  property of a call and an annotation is a property of a tool, and the point of
  the hint is that a host can gate or sandbox such a tool _before_ it sees the
  arguments. `create_rss_subscription` is the broader of the two: Linkwarden
  pulls the feed at once and then creates and archives a link for every entry.

  The test that pinned this asserted `tool.name === 'create_link'`; it now
  compares the open-world set against the set of tools whose schema declares a
  `url`, so the two cannot drift apart again.

- **The `represerve_link` dialog names the host.** A stored link can point at
  `http://10.0.0.1/status` — it may have arrived through the web UI, an import
  or a subscribed feed, none of which this server saw — and re-archiving is a
  fresh outbound fetch of it. `get_link_content` actively steers a model there
  ("call `represerve_link` to have Linkwarden archive the page again"), and the
  question was "delete the preserved copies of link 42 and archive the page
  again", with no way to tell that apart from re-archiving a public page.

  Only the host, on the labelled "supplied by the caller" line. `delete_link`
  withholds the title and the URL on purpose and still does: page prose does not
  belong in front of a person. The host is the part the answer turns on.

- **`rename_tag`'s confirmation key labels its targets.** `setResourceKey` sorts
  its target list, and `String(tag_id)` erased the difference between an id and
  a name — so `{tag_id: 7, name: "12"}` and `{tag_id: 12, name: "7"}` produced
  the same fingerprint, one approval covering two different renames. Both pass
  the schema: a tag called "12" is legal and year or issue-number tags are
  ordinary. The targets are now `tag:<id>` and `name:<name>`.

### Fixed

- **An oversized field no longer cuts the result mid-string.** `untrustedResult`
  capped by slicing the serialized JSON. Readability copies
  `<meta name="description">` into `excerpt`, so a page the caller never chose
  to trust could put 260 kB there — and none of the six metadata fields
  `get_link_content` returns was clamped on that path. The answer was 200 kB of
  attacker-chosen text, no article, no `notes` and no `offset`, in JSON that no
  longer parsed: everything a model needed to recover came last and disappeared
  first.

  Two changes. The metadata now goes through the same `clamp` every other path
  uses, so only `text` can fill the budget and `max_chars` already bounds that.
  And `untrustedResult` shrinks the **largest field** of an envelope instead of
  the document, which is what `jsonResult` beside it has always done and says
  so in a comment.

- **A corrupt readable archive is reported, not quoted.** `get_link_content`
  checked the content type and then called `JSON.parse` unguarded. A body that
  claims JSON and is not — something `api.request()` treats as a thing that
  happens — threw, and `run()` answered with Node's parser message, which quotes
  about ten characters of the body. Those characters come from a saved foreign
  page and reached the model **outside** the untrusted wrapper the rest of the
  handler routes everything through.

- `LINKWARDEN_READ_ONLY` accepts `1`, `true` and `yes`, trimmed and
  case-insensitively, where it used to require the exact string `true`. It fails
  _towards_ the restriction, so `LINKWARDEN_READ_ONLY=1` silently registering
  the write tools is the one outcome it must not have.
  `LINKWARDEN_INSECURE_TLS` keeps the exact-match rule, for the same reason read
  the other way round.

- `docs/guide/security.md` listed three of the four things the SSRF guard does
  not cover and left out `represerve_link`, although the 0.1.3 entry claims both
  files name it. It is there now.

### Added

- Tools that need a confirmation now **ask the user**, on clients that can show
  a prompt. The two-call `confirm_token` remains for clients that cannot, so
  nothing that works today stops working — but where a person can be asked, one
  is, instead of a token that only proves the same call was made twice.

- **`rename_tag` now asks too.** It was annotated `destructiveHint: true` and went
  through unannounced: one call, and every link that carries the tag follows.
  Linkwarden keeps no history of what a tag used to be called, and a saved search
  built on the old name simply stops matching. wikijs guards `update_tag` for the
  same reason.

  The approval is bound to the tag id **and the new name**, so one obtained for
  "rename 3 to reading" does not execute "rename 3 to archive".

- `ELICITATION` switches the dialog off — `false` sends a client that could have
  been asked down the two-call-token path instead. For a scheduled job or a test
  harness, where a dialog is the wrong shape rather than an unwanted one.

  It does **not** remove the guard: there is no setting in which a guarded call
  goes unannounced. Two deliberate rough edges come with it. The variable is
  **not prefixed**, so one `export ELICITATION=false` reaches every MCP server in
  the environment — which is why a server started with it off prints a line
  saying so, and why the fallback text names the server instead of blaming a
  client that was working fine. And a value that is neither `true` nor `false`
  **stops the server**, where the `LINKWARDEN_*` booleans beside it fail _off_ on
  a typo: this is the only variable here that defaults to _on_. It is read after
  `LINKWARDEN_TOKEN` is wiped from the environment, so that exit cannot leave the
  token behind.

- A `docs/guide/approval.md` page, and a 👤 marker in the generated tool
  reference that is read off the registered schema rather than from a list kept
  beside it.

### Changed

- Runs on **MCP SDK 2.0**. Existing clients see the same protocol revision they
  always did; the change is the package layout behind it, and it is what lets
  the dialog above work on both protocol eras from one code path — including
  behind a stateless gateway, where the older mechanism silently fell back to
  the weaker token for every client.

- The linter is **oxlint** instead of eslint plus typescript-eslint, which
  lifts the TypeScript ceiling: typescript-eslint pins `typescript` below 6.1,
  so this repository was held on TypeScript 6 by its linter rather than by its
  code.

- The tool filter, the confirmation store, the host classifier and the
  documentation-asset generator now come from **`mcp-tool-allowlist`**,
  **`mcp-approval`**, **`mcp-internal-hosts`** and **`svg-asset-set`** rather
  than from copies kept here — 1122 fewer lines, and one place to fix each. None
  of them has a runtime dependency of its own.

- The shared libraries move to `mcp-approval` 0.7.1, `mcp-tool-allowlist` 0.2.1,
  `mcp-internal-hosts` 0.2.1, `mcp-integration-harness` 0.2.0 and
  `svg-asset-set` 0.2.0. The harness change shows up in the suite: where a
  security path asserted only that a call failed, it now has to say **why** —
  `expectError: true` is also satisfied by a schema rejection, so a renamed
  argument used to keep such a test green while the guard it names went
  unreached.

- `SECURITY.md` now says what the confirmation **proves**: binding to one
  operation with one set of arguments, not freshness. No replay defence is
  built, because the sealing key is per process, the token is single-use, and
  `requestState` only crosses the wire on protocol revision `2026-07-28`, which
  this server does not offer — it takes the SDK's default list, which ends at
  `2025-11-25`. The section names what would have to change for that to stop
  being true.

- stdio is served through `serveStdio`, so the connection's era is negotiated
  on the opening exchange rather than assumed. A client that pins the
  `2026-07-28` era is served it; until now its `server/discover` probe was
  answered with "Method not found" and only `2025-11-25` was on offer. A client
  that speaks the older era sees no change — it is still pinned to one instance
  for the life of the connection, exactly as a hand-wired
  `StdioServerTransport` served it.

### Fixed

- Confirmation tokens are compared with a **constant-time** comparison. The
  copy in this repository used `!==`, which leaks through timing how much of a
  guess was right. Reaching a token still requires having received it in a
  previous tool result, so this closes a margin rather than a hole.

- An entry in `LINKWARDEN_ALLOW_TOOLS` that is not tool-name-shaped is now
  **redacted** in the error rather than quoted back. `LINKWARDEN_TOKEN` and
  `LINKWARDEN_ALLOW_TOOLS` are adjacent lines in every compose file, and a
  paste into the wrong one used to print the credential into the client's log.

## [0.2.0] - 2026-08-27

### Added

- `LINKWARDEN_ALLOW_TOOLS` and `LINKWARDEN_DENY_TOOLS` choose which of the 28
  tools are registered. Both take comma-separated tool names or a prefix with a
  trailing `*` (`bulk_*`), the allow list decides what is in and the deny list is
  subtracted from it, and `LINKWARDEN_ALLOW_TOOLS=essential` selects a curated
  eight — `search_links`, `get_link`, `get_link_content`, `list_collections`,
  `list_tags`, `create_link`, `update_link`, `delete_link`. A model picks the
  right tool far more reliably from eight than from twenty-eight, and every
  visible tool costs context on every request. Nothing changes for an
  installation that sets neither: all 28 are still registered.

  A filtered tool is not registered at all, so it is absent from `tools/list` and
  answers `tools/call` with "tool not found" — the same cut `LINKWARDEN_READ_ONLY`
  already makes, not a second, weaker one.

  An entry that matches no tool **stops the server at startup**, naming the entry
  and listing the real names, rather than being ignored: an ignored typo leaves a
  tool missing from `tools/list` with nothing pointing at the cause. The same
  applies to a malformed pattern such as `*_link`. Under `LINKWARDEN_READ_ONLY`,
  an exact write-tool name in the allow list is refused with a message naming the
  read-only setting instead of calling the tool unknown, while a pattern covering
  write tools is accepted and simply contributes nothing.

  The tool reference marks the preset members, generated from the same constant
  the filter reads, so the two cannot drift apart.

### Changed

- The README now carries the same eight badges, in the same order, as every other
  MCP server in this family, all of them reading from npm rather than hard-coded;
  the opening follows one shape; and the standalone "Full documentation" line is
  gone, because the docs badge three lines above it points at the same page.

### Fixed

- The container image no longer ships OpenSSL 3.5.7-r0, which carries
  **CVE-2026-14456** (denial of service via unbounded memory growth). The pinned
  `node:24-alpine` digest is already the newest one; Alpine's fixed 3.5.8-r0 has
  simply not been rebuilt into it yet, so the runtime stage now upgrades
  `libcrypto3` and `libssl3` by name. Upgrading those two rather than running a
  blanket `apk upgrade` keeps the rest of the image exactly as the digest pins
  it. The step can go once the base image ships the fix.

## [0.1.4] - 2026-08-26

### Fixed

- A bookmark whose domain a resolver sinkholes is no longer refused. Every ad
  blocker and DNS filter answers `0.0.0.0` for a blocked name, and `0.0.0.0/8`
  classifies as loopback — so 0.1.3 turned "your resolver blocks this domain"
  into "refusing to point Linkwarden at a loopback address", which was both
  wrong and unhelpful. A resolved unspecified address is now passed over; it
  addresses nothing and nothing can be fetched from it. `0.0.0.0` written into
  the URL itself is still refused, because that one does address the host.

## [0.1.3] - 2026-08-26

### Security

- The URLs handed to Linkwarden are now checked against the host they address.
  `create_link`, `update_link` and `create_rss_subscription` make the _Linkwarden_
  server fetch a caller-supplied URL — through the headless-browser preserver or,
  for a feed, immediately — and `get_link_content` reads the preserved text back
  out. Only the scheme was validated, so `http://169.254.169.254/latest/meta-data/`
  or a port on the Linkwarden host's own loopback was a perfectly acceptable
  bookmark, and its response came back to the caller. That is reachable from text
  inside a page the account has already saved. Loopback and link-local addresses
  are now refused, together with the metadata service's hostnames
  (`metadata.google.internal`, `instance-data` and their siblings), which resolve
  only on the instance itself.
- Addresses are compared numerically instead of as strings, because `URL`
  canonicalises an IPv4-mapped IPv6 literal before any check sees it:
  `http://[::ffff:169.254.169.254]/` arrives as `[::ffff:a9fe:a9fe]` while every
  dual-stack client dials it as plain `169.254.169.254`. The IPv4-compatible,
  IPv4-translated and NAT64 spellings are unwrapped the same way, and `localhost.`
  with its root label is read as `localhost`.
- What is sent to Linkwarden is the parsed URL rather than the string that came
  in, so the address that was checked is the one that gets fetched.
  `http://ok.example.com\@127.0.0.1/feed` has the host `ok.example.com` for a URL
  parser and `127.0.0.1` for a fetcher that splits at the `@`.
- A hostname that is not a literal address is resolved and its addresses are
  checked, so a DNS record pointing at `127.0.0.1` or `169.254.169.254` no longer
  walks around the guard. A name that cannot be resolved here is still passed on:
  the Linkwarden server may sit in a different network with its own resolver.

- The metadata endpoints outside `169.254/16` are refused as well:
  `100.100.100.200` (Alibaba Cloud) and `192.0.0.192` (Oracle's legacy endpoint) sit
  in carrier-grade NAT and IETF assignment space respectively, so no range check
  reaches them, but they are the same thing by purpose.
- The classifier strips an IPv6 scope id before deciding. `net.isIP` accepts
  `::ffff:127.0.0.1%eth0`, which made the dotted-quad fold miss its anchor and the
  address come out as routable. A URL can never carry one, but a resolver answer can.

Private LAN addresses (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`) stay allowed
— bookmarking the router's web interface, a NAS or an intranet page is a normal
thing to do with a self-hosted bookmark manager. `SECURITY.md` and the security
guide now state what the check cannot cover, and say it plainly rather than in
passing: redirects and whatever the headless browser loads from a page, the window
between this lookup and Linkwarden's own, a name whose resolution is simply stalled
past the timeout, `represerve_link`, containers sitting next to Linkwarden on a
compose network — and above all the entries inside an RSS feed, which Linkwarden
creates and preserves links for without checking their addresses at all before
version 2.14.

### Changed

- `update_link` compares the new URL with the stored one in parsed form, and writes
  the parsed form back **only when it really is a change**. Re-sending the same URL
  spelled differently no longer counts as one, which would have asked for a
  confirmation and then destroyed every preserved copy for nothing — and because
  Linkwarden decides that by exact string equality, the re-spelled URL must not be
  written back either, or the archives would have gone silently.
- The description of `create_rss_subscription` no longer says that a feed "pointing
  at a private address is rejected right away" — that described Linkwarden's
  behaviour, not this server's. It now says which addresses this server refuses, and
  warns that the check covers the feed URL and not the entries inside it.
- The description of `create_link` no longer tells the model that a private LAN
  address "is fine". This server accepts one, but Linkwarden 2.14 and later refuse to
  preserve it, so the bookmark is created and permanently has no archive to read.
- The host classifier lives in `src/hosts.ts` as a leaf module with no imports of its
  own, and the tool-facing check that throws moved to `src/schema.ts`. Having the
  classifier reach `result.ts` put `config.ts` in an import cycle that held only
  because the functions in it happen to be hoisted.

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
