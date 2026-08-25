<!--
  GENERATED FILE — do not edit by hand.
  Regenerate with: npm run build && npm run docs:tools
  The CI test job fails when this file is out of date.
-->

# Tool reference

All 28 tools: 11 read, 17 write.
With `LINKWARDEN_READ_ONLY=true` the write tools are not registered at all —
they do not appear in `tools/list`.

Tools marked **write, destructive** need a confirmation token: call them once
without `confirm_token` to get one, then again with it. The token is bound to the
exact target and expires after five minutes. See [Security](/guide/security).

## Read tools

### `search_links`

**Search and list links** — read-only

Searches bookmarks, or lists them when no query is given. This is the way to find links — there is no separate list tool, and the older /links listing route is deprecated upstream. Plain text matches the title, URL, description and tag names of a link. IMPORTANT: the field-filter syntax below only works on instances that run Meilisearch. Linkwarden parses those filters exclusively in its Meilisearch branch; without it the whole query is matched as one literal substring, so `tag:news` searches for the characters "tag:news" and finds nothing. Use the collection_id, tag_id and pinned_only arguments instead — those are applied by the database and work either way. list_collections and list_tags give you the ids. Where Meilisearch is available the filters are: url: name: description: type: collection: tag: pinned: public: before: after: Quote values that contain spaces, e.g. collection:"Read later". Prefix a filter with ! to negate it, e.g. !tag:archive. pinned: and public: take true or false; before: and after: take a date such as 2026-01-31. If the instance sets SEARCH_FILTER_LIMIT, field filters beyond that count are dropped silently, so prefer few, specific filters. Returns at most 100 links plus a next_cursor for the following page. Article text is not included; use get_link_content for that.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | no | Search query, see the syntax above. Omit to list links. |
| `collection_id` | integer | no | Restrict the result to this collection |
| `tag_id` | integer | no | Restrict the result to this tag |
| `pinned_only` | boolean | no | Only return links pinned by the authenticated account |
| `sort` | `"date_newest"` \| `"date_oldest"` \| `"name_az"` \| `"name_za"` | no | Sort order, default date_newest |
| `cursor` | integer | no | Opaque pagination cursor. Pass back the "next_cursor" value from a previous result verbatim; do not compute or increment it — depending on whether the instance runs Meilisearch it is either a row offset or the last id seen. |

### `get_link`

**Get a link** — read-only

Fetches one bookmark with its tags, collection and which preserved formats exist. Does not include the archived page text — use get_link_content for that.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | integer | yes | Numeric id of the link — the "id" field returned by search_links, not its title or URL |

### `get_link_content`

**Read the preserved text of a link** — read-only

Returns the readable article text Linkwarden extracted and stored when it preserved the page, so a saved bookmark can be read without fetching the live site. Only the readable format is served: the screenshot, PDF and single-file HTML archives are binary or raw markup and are not useful as text. Long articles are returned in slices — pass the offset from the previous result to continue. If the link has no readable archive, the tool says so and represerve_link can create one.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | integer | yes | Numeric id of the link — the "id" field returned by search_links, not its title or URL |
| `offset` | integer | no | Character offset to start at, default 0 |
| `max_chars` | integer | no | Maximum characters to return, default 20000 |

### `list_collections`

**List collections** — read-only

Lists every collection the authenticated account owns or is a member of, with its link count. The list is flat: nesting is expressed through parentId, where null means the collection sits at the top level. Linkwarden does not page this route, so all collections come back at once.

Takes no parameters.

### `get_collection`

**Get a collection** — read-only

Fetches one collection with its link count and the per-member create/update/delete permissions. Use search_links with collection_id to get the links inside it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | integer | yes | Numeric id of the collection — the "id" field returned by list_collections |

### `list_tags`

**List tags** — read-only

Lists the tags of the authenticated account with the number of links each one is attached to. Tags cut across collections. The per-tag archival settings are included: null there means "inherit the account default", which is not the same as false.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `search` | string | no | Only return tags whose name contains this text |
| `sort` | `"date_newest"` \| `"date_oldest"` \| `"name_az"` \| `"name_za"` \| `"link_count_high_low"` \| `"link_count_low_high"` | no | Sort order, default date_newest |
| `cursor` | integer | no | Opaque pagination cursor. Pass back the "next_cursor" value from a previous result verbatim; do not compute or increment it — depending on whether the instance runs Meilisearch it is either a row offset or the last id seen. |

### `get_tag`

**Get a tag** — read-only

Fetches one tag with its archival settings. Use search_links with tag_id to get the links carrying it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tag_id` | integer | yes | Numeric id of the tag — the "id" field returned by list_tags |

### `get_current_user`

**Get the authenticated account** — read-only

Reports which Linkwarden account the configured token belongs to and that account's archival defaults — which formats new links get preserved in, and whether duplicate URLs are rejected. Useful as a connectivity check and before creating links, because the defaults decide what get_link_content will later have to read.

Takes no parameters.

### `get_dashboard`

**Get the dashboard links** — read-only

Returns the links Linkwarden shows on its dashboard: the most recently added ones together with everything the account has pinned, deduplicated. A quick "what is going on here" overview — use search_links for anything targeted.

Takes no parameters.

### `list_rss_subscriptions`

**List RSS subscriptions** — read-only

Lists the RSS feeds this account subscribes to. Linkwarden polls them and files new entries as links in the configured collection.

Takes no parameters.

### `get_worker_stats`

**Get preservation queue statistics** — read-only

Reports how many links are waiting to be preserved, how many succeeded and how many failed, plus the search-index backlog. Use it to find out whether a page requested through represerve_link has been archived yet. Requires the instance administrator account (the id in NEXT_PUBLIC_ADMIN, 1 by default); every other account gets HTTP 403 here. The counts cover the whole instance, not just this account.

Takes no parameters.

## Write tools

### `create_link`

**Create a link** — write

Saves a bookmark. Linkwarden fetches the page title itself when no name is given, and queues the page for preservation according to the account defaults (get_current_user shows them). The collection is optional; without one the link lands in "Unorganized". Naming a collection that does not exist creates it. If the account has "prevent duplicate links" enabled, saving a URL twice fails with HTTP 409. Linkwarden does the fetching, so a URL addressing its own loopback, the link-local range or a cloud metadata endpoint is refused here. A private LAN address is accepted by this server, but Linkwarden 2.14 and later refuse to preserve one themselves — the bookmark is created and stays without an archive, so get_link_content will have nothing to return.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | URL to bookmark, including the scheme |
| `name` | string | no | Title. Omit to let Linkwarden read it from the page. |
| `description` | string | no |  |
| `collection_id` | integer | no | Target collection. Mutually exclusive with collection_name. |
| `collection_name` | string | no | Target collection by name; it is created if it does not exist. Mutually exclusive with collection_id. |
| `tags` | string[] | no | Tag names. Tags that do not exist yet are created. |

### `update_link`

**Update a link** — write

Changes a bookmark. Fields that are not given stay as they are: the tool reads the link first and merges, because the underlying route replaces the whole record and would otherwise clear the title, description and every tag. The tags argument REPLACES the tag list — pass the full set you want. Moving a link to another collection only works for the collection owner. Changing the URL is destructive and needs a confirmation token: Linkwarden deletes every preserved copy of the old page (screenshot, PDF, readable text, single-file HTML) and starts over.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | integer | yes | Numeric id of the link — the "id" field returned by search_links, not its title or URL |
| `name` | string | no | New title |
| `url` | string | no | New URL — destroys the existing preserved copies |
| `description` | string | no |  |
| `collection_id` | integer | no | Move the link to this collection (owner only) |
| `tags` | string[] | no | Replacement tag list. Omit to keep the current tags, pass [] to remove all of them. |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `set_link_pinned`

**Pin or unpin a link** — write

Pins a link to the account's dashboard, or removes the pin. Pins are per account, so this only affects the account the token belongs to. Pinned links can be listed with search_links and pinned_only=true.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | integer | yes | Numeric id of the link — the "id" field returned by search_links, not its title or URL |
| `pinned` | boolean | yes | true to pin, false to unpin |

### `delete_link`

**Delete a link** — write, destructive

Deletes a bookmark and every preserved copy of the page. Two-step: the first call returns a confirmation token, the second call with that token performs the deletion.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | integer | yes | Numeric id of the link — the "id" field returned by search_links, not its title or URL |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `bulk_update_links`

**Retag or move many links at once** — write, destructive

Applies the same tag list and/or target collection to a set of links. Cheaper than one update_link per link, but far blunter: it can only set tags and move collections, and the tag list applies to every link in the set. With replace_tags=true the given tags REPLACE whatever each link had, so an empty tag list strips all tags from all of them. With replace_tags=false the tags are added to the existing ones. Either way this needs a confirmation token, because it rewrites many records at once.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_ids` | integer[] | yes | Link ids, at most 200 |
| `tags` | string[] | yes | Tag names to apply to every link in the set. Pass [] with replace_tags=true to strip all tags. |
| `replace_tags` | boolean | yes | true replaces each link's tags with the given list, false adds to them |
| `collection_id` | integer | no | Move every link to this collection (owner only) |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `bulk_delete_links`

**Delete many links at once** — write, destructive

Deletes a set of bookmarks and all their preserved copies. Two-step: the first call returns a confirmation token that is bound to exactly this set of ids — adding an id afterwards invalidates it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_ids` | integer[] | yes | Link ids, at most 200 |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `represerve_link`

**Preserve a link again** — write, destructive

Has Linkwarden archive the page again. This first DELETES the existing preserved copies and only then re-queues the link, so if the site is gone or now blocks the archiver, the old copies are lost and nothing replaces them. That is why it needs a confirmation token. The work happens in a background worker; get_worker_stats shows the queue.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | integer | yes | Numeric id of the link — the "id" field returned by search_links, not its title or URL |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `delete_link_preservations`

**Delete the preserved copies of links** — write, destructive

Removes the archived screenshot, PDF, readable text and single-file HTML of a set of links while keeping the bookmarks themselves. Useful to reclaim disk space. Unlike represerve_link this does NOT re-archive anything — use that tool if the copies should be recreated.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `link_ids` | integer[] | yes | Link ids, at most 200 |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `create_collection`

**Create a collection** — write

Creates a collection. Pass parent_id to nest it under an existing collection. New collections are private; use update_collection to publish one.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Collection name |
| `description` | string | no |  |
| `parent_id` | integer | no | Nest the new collection under this one |
| `color` | string | no | Accent colour as a hex value, e.g. #0ea5e9 |

### `update_collection`

**Update a collection** — write

Changes a collection. Fields that are not given stay as they are: the tool reads the collection first and merges, because the underlying route rebuilds the member list from the request body and would otherwise remove every collaborator. Only the owner of a collection may update it. To move a collection to the top level pass parent_id=0 — Linkwarden needs an explicit marker for that and ignores null. Setting is_public=true needs a confirmation token: it makes the collection and every link in it readable by anyone who has the URL, without logging in.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | integer | yes | Numeric id of the collection — the "id" field returned by list_collections |
| `name` | string | no |  |
| `description` | string | no |  |
| `parent_id` | integer | no | Id of the new parent collection, or 0 to move this collection to the top level |
| `is_public` | boolean | no | true publishes the collection to anyone with the link (needs confirmation), false makes it private again |
| `color` | string | no |  |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `delete_collection`

**Delete a collection** — write, destructive

Deletes a collection. This cascades: every link inside it, every preserved copy of those pages, and every sub-collection below it are deleted too. Two-step: the first call reports how many links would be lost and returns a confirmation token.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | integer | yes | Numeric id of the collection — the "id" field returned by list_collections |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `create_tags`

**Create tags or change their archival settings** — write

Creates tags, or updates the ones that already exist — the underlying route is an upsert keyed on the tag name. This is also the only way to set the per-tag archival overrides, which decide how links carrying the tag get preserved. Note that tags are usually created implicitly by create_link and update_link; use this tool when the archival settings matter, or to create a tag before any link uses it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `names` | string[] | yes | Tag names, at most 50. Existing tags are updated rather than duplicated. |
| `archive_as_screenshot` | unknown | no | Store a screenshot for links carrying this tag. null inherits the account default. |
| `archive_as_pdf` | unknown | no | Store a PDF for links carrying this tag. null inherits the account default. |
| `archive_as_readable` | unknown | no | Store the readable article text (this is what get_link_content reads) for links carrying this tag. null inherits the account default. |
| `archive_as_monolith` | unknown | no | Store a single-file HTML copy for links carrying this tag. null inherits the account default. |
| `archive_as_wayback_machine` | unknown | no | Submit the URL to the Internet Archive for links carrying this tag. null inherits the account default. |
| `ai_tag` | unknown | no | Let the configured AI model assign this tag for links carrying this tag. null inherits the account default. |

### `rename_tag`

**Rename a tag** — write

Renames a tag; every link carrying it keeps it. Tag names are unique per account, so renaming a tag to a name that already exists fails — use merge_tags to fold two tags into one instead.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tag_id` | integer | yes | Numeric id of the tag — the "id" field returned by list_tags |
| `name` | string | yes | New tag name |

### `delete_tags`

**Delete tags** — write, destructive

Deletes one or more tags. The links keep existing, they just lose the tag. Two-step: the first call returns a confirmation token bound to exactly this set of ids.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tag_ids` | integer[] | yes | Tag ids, at most 50 |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `merge_tags`

**Merge tags into one** — write, destructive

Folds several tags into a single new one: every link that carried any of the source tags gets the new tag, and the source tags are deleted. Two things to know before calling this. The new tag is created from scratch, so the name must not already be in use by this account — merging into an existing name fails. And the per-tag archival settings of the source tags are not carried over; set them again with create_tags afterwards if they mattered.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tag_ids` | integer[] | yes | Ids of the tags to merge away |
| `new_name` | string | yes | Name of the new tag. Must not exist yet. |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |

### `create_rss_subscription`

**Subscribe to an RSS feed** — write

Subscribes to an RSS or Atom feed. Linkwarden polls it and files every new entry as a link in the given collection, preserving the pages according to the account defaults. Linkwarden fetches the feed once immediately, so an unreachable feed fails right away. Because that fetch happens on the Linkwarden server, a URL addressing its own loopback or the link-local range is refused here before the request is made. That check covers the feed URL only — Linkwarden creates and preserves a link for every entry the feed contains, and on versions before 2.14 it does not check those addresses at all. Do not subscribe to a feed you do not trust. Subscription names must be unique per account, and instances cap the number of subscriptions (20 by default).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Name for the subscription, unique within the account |
| `url` | string | yes | Feed URL, including the scheme |
| `collection_id` | integer | no | Collection the entries land in. Mutually exclusive with collection_name. |
| `collection_name` | string | no | Collection by name; it is created if it does not exist. Mutually exclusive with collection_id. |

### `delete_rss_subscription`

**Delete an RSS subscription** — write, destructive

Stops polling a feed. Links that were already created from it stay where they are — only the subscription goes away.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `rss_subscription_id` | integer | yes | Numeric id of the RSS subscription — the "id" field returned by list_rss_subscriptions |
| `confirm_token` | string | no | Confirmation token from a previous call of this tool with the same arguments. Omit on the first call. |
