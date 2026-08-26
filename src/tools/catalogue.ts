/**
 * The tools this server can register, declared rather than discovered.
 *
 * Declared, because the tool filter has to answer "is this a name you have?"
 * *before* anything is registered — and in read-only mode the write tools are
 * never registered at all. Deriving the catalogue from what actually reached
 * `registerTool` would make `LINKWARDEN_ALLOW_TOOLS=delete_link` report
 * "unknown tool" under `LINKWARDEN_READ_ONLY=true`, which is the one answer
 * that is wrong.
 *
 * This is also the full tool surface, hard-coded on purpose: a tool that
 * appears or disappears by accident is a change to the server's contract and
 * has to be a deliberate edit here. `test/server.test.ts` asserts that these
 * lists and the tools the server really registers are the same set.
 */

/** Registered always. Every one carries `readOnlyHint: true`. */
export const READ_TOOLS = [
  'search_links',
  'get_link',
  'get_link_content',
  'list_collections',
  'get_collection',
  'list_tags',
  'get_tag',
  'get_current_user',
  'get_dashboard',
  'list_rss_subscriptions',
  'get_worker_stats',
] as const;

/** Registered unless `LINKWARDEN_READ_ONLY` is set. */
export const WRITE_TOOLS = [
  'create_link',
  'update_link',
  'set_link_pinned',
  'delete_link',
  'bulk_update_links',
  'bulk_delete_links',
  'represerve_link',
  'delete_link_preservations',
  'create_collection',
  'update_collection',
  'delete_collection',
  'create_tags',
  'rename_tag',
  'delete_tags',
  'merge_tags',
  'create_rss_subscription',
  'delete_rss_subscription',
] as const;

/** Every tool, read-only mode aside. */
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS];

/**
 * What `LINKWARDEN_ALLOW_TOOLS=essential` selects: save, find, read.
 *
 * Eight of twenty-eight. `get_link_content` is in it because the preserved
 * readable text is the actual reason to point a model at Linkwarden;
 * `list_collections` and `list_tags` because they are the two axes everything
 * else is filed under. Left out on purpose: `bulk_update_links` and
 * `bulk_delete_links` (footguns by design), the preservation-queue admin tools,
 * RSS subscriptions, and collection and tag CRUD.
 */
export const ESSENTIAL_TOOLS: readonly string[] = [
  'search_links',
  'get_link',
  'get_link_content',
  'list_collections',
  'list_tags',
  'create_link',
  'update_link',
  'delete_link',
];
