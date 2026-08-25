import { z } from 'zod';

import { firstInternalAddress } from './hosts.js';
import { ToolInputError } from './result.js';

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

/**
 * A URL that Linkwarden may be asked to fetch.
 *
 * Zod's own `.url()` only checks that `new URL()` parses the value, so it accepts
 * `javascript:`, `file:`, `data:` and `ftp:` just as happily as `https:`. That is
 * not cosmetic here: every URL validated by this schema is handed to Linkwarden,
 * which opens it in its headless-browser preserver (`create_link`, `update_link`)
 * or fetches it immediately (`create_rss_subscription`). A model that picked up an
 * injected instruction out of a preserved page could otherwise have this server
 * bookmark `file:///etc/passwd`, let the archiver render it, and read the result
 * back through `get_link_content` — a file-disclosure primitive assembled entirely
 * out of valid tool calls. Restricting the scheme closes that path at the input.
 *
 * The *host* is checked separately, by `assertFetchableUrl` in the tool handlers:
 * that check resolves names, which a Zod refinement cannot do because it is
 * synchronous. This schema is the early, cheap half — it gives the model a
 * useful error before any work happens — and it is not the boundary.
 */
export const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  }, 'must be an absolute http:// or https:// URL');

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

/**
 * Validates a URL Linkwarden will be asked to fetch, and returns the form that
 * should be sent.
 *
 * Every URL that reaches this is retrieved by the *Linkwarden* server:
 * `create_link` and `update_link` queue the page for the headless-browser
 * preserver, `create_rss_subscription` fetches the feed immediately.
 * `get_link_content` then reads the preserved text back out — so an unchecked
 * URL here is not just a request from inside Linkwarden's network, it is a
 * request whose response comes back to the caller.
 *
 * The returned string is the parsed URL, not the input. Handing on the original
 * would mean checking one thing and fetching another: the host of
 * `http://ok.example.com\@127.0.0.1/` is `ok.example.com` to a URL parser and
 * `127.0.0.1` to a fetcher that splits at the `@`.
 *
 * This lives here rather than next to the classifier so that `hosts.ts` stays a
 * leaf module. `config.ts` needs the classifier, and everything that reports a
 * tool error needs `result.ts`, which reaches `config.ts` in turn — an import
 * cycle that works today only because the functions involved happen to be
 * hoisted.
 */
export async function assertFetchableUrl(value: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ToolInputError(`not a valid URL: ${value.slice(0, 200)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ToolInputError(
      `refusing ${parsed.protocol} — only http:// and https:// can be bookmarked. ` +
        'Linkwarden opens the URL in its archiver, so a file:// or similar scheme ' +
        'would have it read from its own disk instead of fetching a page.'
    );
  }

  const internal = await firstInternalAddress(parsed.hostname);
  if (internal !== null) {
    const where =
      internal.address === parsed.hostname.toLowerCase()
        ? internal.address
        : `${parsed.hostname} (${internal.address})`;
    throw new ToolInputError(
      `refusing to point Linkwarden at ${where}: that is a ${internal.kind} ` +
        'address. Linkwarden fetches the URL itself and this server can read the ' +
        'preserved page back, so loopback and link-local addresses — the server ' +
        'itself and its cloud metadata service — are not valid bookmarks. Use a ' +
        'routable URL.'
    );
  }
  return parsed.toString();
}
