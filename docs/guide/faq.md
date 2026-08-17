# FAQ & troubleshooting

## The three errors that cover almost everything

### `401 Unauthorized`

The token is wrong, expired or revoked. Linkwarden tokens can carry an expiry and can be
revoked under **Settings → Access Tokens**; both answer 401, indistinguishably.

Check that the value starts with `ey` — Linkwarden's tokens are NextAuth JWTs. If it
does not, a session cookie or a password was probably pasted in. The server warns about
this at startup, before the first failing call.

### `403 Forbidden`

The token is valid but its account lacks permission. Collections are shared per member
with separate create/update/delete flags, so an account can see a collection and still
not be allowed to write to it. Check the collection's members in Linkwarden.

`get_worker_stats` returns 403 for everyone except an administrator account. That is
expected, not a misconfiguration.

### A redirect error

Requests never follow redirects — that is deliberate, because a redirect would replay
the `Authorization` header to whatever host it names. If you get one, `LINKWARDEN_URL`
is pointing at something that redirects: usually `http://` where the instance forces
`https://`, or a host that redirects to a canonical domain.

Set `LINKWARDEN_URL` to the final URL. A `/api/v1` suffix is handled for you.

## Why does search find nothing useful?

Because your Linkwarden probably does not run Meilisearch.

Linkwarden parses `search_links` field filters — `tag:`, `collection:`, `pinned:`,
`before:`, `after:` and `!` for negation — **only in its Meilisearch branch**. Without
Meilisearch the whole query is matched as a single literal substring, so `tag:news`
looks for those nine characters in your titles and descriptions and finds nothing.

The server detects this case and says so in the result. Two ways forward:

- **Filter structurally instead.** The `collection_id`, `tag_id` and `pinned_only`
  arguments are applied by the database and work either way. This is the reliable
  answer.
- **Run Meilisearch.** Linkwarden's own documentation covers the setup, after which the
  field filters work as advertised.

Plain search terms without a `field:` prefix work in both configurations.

## `get_link_content` says there is no readable archive

Only the *readable* format can be served as text. The screenshot, PDF and single-file
HTML archives are binary or raw markup, and turning them into text would be worse than
useless.

The result tells you which formats do exist. If `readable` is missing:

- **Preservation may still be running.** `get_worker_stats` shows the queue (admin
  accounts only).
- **It may have failed.** `represerve_link` drops the existing archives and tries again.
- **It may be switched off.** Check `archiveAsReadable` in the account defaults
  (`get_current_user`) and any per-tag override (`list_tags`).

## Why did a bookmark lose its tags when I renamed it?

It should not, and with this server it does not — but it is worth knowing why the
question comes up. Linkwarden's `PUT /links/{id}` is a **replacement**: it applies tags
with `set: []` first and writes `name`/`description` as `data.name || ""`. A partial
body therefore erases whatever it omits.

This server reads the current record and merges before writing, so omitted fields keep
their values. If you drive the API directly, you have to do the same.

## Why does deleting a collection remove links?

Because Linkwarden cascades: a collection's links and its sub-collections go with it.
That is why `delete_collection` requires a confirmation token and says so in the prompt.

To keep the links, move them to another collection first — `bulk_update_links` can do
that for a whole batch.

## Why does `update_link` sometimes want a confirmation and sometimes not?

Only when you change the **URL**. Linkwarden deletes every preserved copy of the old
page when the URL changes, which is irreversible, so it is treated like a deletion.
Changing the title, description, tags or collection needs no confirmation.

The same asymmetry applies to `update_collection`: publishing a collection
(`is_public=true`) needs a confirmation, unpublishing does not.

## Can I stop it from writing anything?

`LINKWARDEN_READ_ONLY=true`. The write tools are not registered at all — they never
appear in `tools/list`. Pair it with an account that only has read access for a
belt-and-braces setup.

## Creating a link created a duplicate collection

If you pass a collection **name** that already exists, Linkwarden's raw API happily
creates a second collection with the same name — names are not unique. Pass
`collection_id` when you mean an existing collection, and `collection_name` only when
you want one created.

`list_collections` gives you the ids.

## Self-signed certificate

`LINKWARDEN_INSECURE_TLS=true` accepts it, scoped to this connection only. Better: add
your internal CA to the system trust store or point `NODE_EXTRA_CA_CERTS` at it, which
keeps validation intact.

## Which Linkwarden versions work?

Developed and verified against **v2.16.0**. Nearby versions are very likely fine — the
v1 API is stable in practice — but Linkwarden's published API reference is incomplete,
so this server was written against the route handlers themselves. If a tool misbehaves
on your version, please [open an issue](https://github.com/ni-c/linkwarden-mcp/issues)
with the version number.

## Something else

- Questions and ideas → [Discussions](https://github.com/ni-c/linkwarden-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/linkwarden-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/linkwarden-mcp/security/advisories/new)
