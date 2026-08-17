import { z } from 'zod';

/**
 * Shared input primitives.
 *
 * Linkwarden identifies everything by a numeric database id, so the ids are
 * validated as integers rather than as path segments — a non-numeric value is
 * rejected by the schema before the handler runs, and nothing that could escape
 * a URL path ever reaches {@link idPath}.
 */

const id = (what: string) =>
  z.number().int().positive().describe(`Numeric id of the ${what}`);

export const linkId = id('link').describe(
  'Numeric id of the link — the "id" field returned by search_links, not its title or URL'
);

export const collectionId = id('collection').describe(
  'Numeric id of the collection — the "id" field returned by list_collections'
);

export const tagId = id('tag').describe(
  'Numeric id of the tag — the "id" field returned by list_tags'
);

export const rssSubscriptionId = id('RSS subscription').describe(
  'Numeric id of the RSS subscription — the "id" field returned by list_rss_subscriptions'
);

export const cursor = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe(
    'Opaque pagination cursor. Pass back the "next_cursor" value from a previous ' +
      'result verbatim; do not compute or increment it — depending on whether the ' +
      'instance runs Meilisearch it is either a row offset or the last id seen.'
  );

export const confirmToken = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Confirmation token from a previous call of this tool with the same arguments. Omit on the first call.'
  );

/**
 * Sort orders. Linkwarden takes an integer enum on the wire; the readable names
 * are mapped here so a caller never has to guess what `sort=2` means.
 */
const LINK_SORTS = {
  date_newest: 0,
  date_oldest: 1,
  name_az: 2,
  name_za: 3,
} as const;

const TAG_SORTS = {
  ...LINK_SORTS,
  link_count_high_low: 4,
  link_count_low_high: 5,
} as const;

export const linkSort = z
  .enum(Object.keys(LINK_SORTS) as [keyof typeof LINK_SORTS])
  .optional()
  .describe('Sort order, default date_newest');

export const tagSort = z
  .enum(Object.keys(TAG_SORTS) as [keyof typeof TAG_SORTS])
  .optional()
  .describe('Sort order, default date_newest');

export function linkSortValue(name: keyof typeof LINK_SORTS | undefined) {
  return name === undefined ? undefined : LINK_SORTS[name];
}

export function tagSortValue(name: keyof typeof TAG_SORTS | undefined) {
  return name === undefined ? undefined : TAG_SORTS[name];
}

/** Archived formats as Linkwarden numbers them. */
export const ArchivedFormat = {
  png: 0,
  jpeg: 1,
  pdf: 2,
  readability: 3,
  monolith: 4,
} as const;

/** Builds a path with a numeric id, rejecting anything that is not one. */
export function idPath(prefix: string, value: number, suffix = ''): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid id: ${String(value)}`);
  }
  return `${prefix}/${value}${suffix}`;
}

/** Appends the defined entries of `params` as a query string. */
export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.size > 0 ? `${path}?${query.toString()}` : path;
}
