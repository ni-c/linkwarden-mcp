/**
 * The annotation block every reading tool of this server carries, and the rule
 * the writing ones follow.
 *
 * Written out rather than left to the defaults, because the defaults are not
 * neutral: the specification says `destructiveHint` and `openWorldHint` both
 * default to **true**, so an omitted field is the *stronger* claim. A tool that
 * says nothing is a destructive tool in an open world.
 *
 * The line this family draws for `destructiveHint`, since the specification
 * only offers "destructive" against "additive only":
 *
 *   **Content that a person wrote, replaced with no way back — destructive.**
 *   **A setting, a state or a marker, changed — not destructive.**
 *
 * Linkwarden adds a second thing worth losing: the *preserved copies*. A link
 * is a URL somebody saved, but the archive behind it is a snapshot of a page
 * that may no longer exist. `update_link` is destructive for that reason alone
 * — changing the URL discards the archive and fetches a new one, and the old
 * snapshot is not recoverable from anywhere.
 *
 * `openWorldHint`: false everywhere except `create_link`, which hands
 * Linkwarden a URL of the caller's choosing and has it fetch that page. Where
 * the caller picks the address, the world is open — and that is the same
 * boundary the SSRF guard watches.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
