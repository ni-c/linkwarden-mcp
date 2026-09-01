# What is linkwarden-mcp?

[Linkwarden](https://linkwarden.app) is a self-hosted bookmark manager whose defining
feature is that it does not just store a URL: when you save a page, it keeps a copy —
as readable article text, as a PDF, as a screenshot, and as a single-file HTML archive.
Your bookmarks survive the pages they point at.

`linkwarden-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server
that puts that collection in reach of an assistant. It exposes 28 tools over stdio: 11
that read and 17 that write.

## What it is good at

**Answering from what you already saved.** `get_link_content` returns the article text
Linkwarden extracted when it preserved the page. An assistant can summarise, compare or
quote a bookmark from months ago without going back to the live web — which matters
most exactly when the original has changed, moved behind a paywall, or disappeared.

**Keeping the collection tidy.** Creating links, moving them between collections,
renaming and merging tags, bulk-tagging a batch of search results.

**Not being a foot-gun.** The parts that are easy to get wrong are handled explicitly:
partial updates merge rather than replace, output is an allowlist rather than a dump of
Linkwarden's database rows, and anything destructive [asks a person](/guide/approval) — bound
to the exact target.

## What it deliberately does not do

- **Access-token management.** A tool that can mint API credentials is a
  privilege-escalation surface.
- **User administration**, including account deletion.
- **Backup export and import.** The export dumps the whole instance into the model's
  context; the import can destroy it.
- **Highlights.** Creating one needs exact character offsets into the preserved
  document, which a model cannot produce meaningfully, and Linkwarden has no route to
  list existing ones.
- **Archive uploads** and the signed `preserved` URLs, which need
  `NEXT_PUBLIC_USER_CONTENT_DOMAIN` configured.

## A note on the source of truth

Linkwarden's published API reference is incomplete. This server was written against the
routes in `apps/web/pages/api/v1/**` and the request schemas in
`packages/lib/schemaValidation.ts` of
[linkwarden/linkwarden](https://github.com/linkwarden/linkwarden), verified against
**v2.16.0**. Where the two disagree, the code wins — and the surprises that came out of
that reading are documented in [Security](/guide/security) and the
[FAQ](/guide/faq), because they change what a caller should expect.

## Next

- [Getting started](/guide/getting-started) — token, install, first call
- [Connecting clients](/guide/clients) — Claude Code, Claude Desktop, Codex, Docker
- [Tool reference](/reference/tools) — all 28 tools
