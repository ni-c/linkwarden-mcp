/**
 * The boundary between what the instance sent and what this server reasons
 * about.
 *
 * Every response used to be a TypeScript cast — `(await api.get(path)) as
 * RawLink[]` — which is not a check. Two layers behind it *are* checked: the
 * projections in `shape.ts` call `.map`, `.length` and `.slice` on whatever
 * arrived, and the SDK validates `structuredContent` against the `outputSchema`
 * each tool declares. So a single field of the wrong type cost the whole
 * answer, and every one of these is one line in the JSON of an instance, of a
 * proxy in front of it, or of whatever a mistyped `LINKWARDEN_URL` lands on:
 *
 * - `{"links": {}}` — `(result.links ?? []).slice is not a function`
 * - `{"links": [null]}` — `Cannot read properties of null (reading 'id')`
 * - a link whose `tags` is an object — `(link.tags ?? []).map is not a function`
 * - `{"nextCursor": 1e999}` — `Infinity` after `JSON.parse`, which
 *   `z.number().int()` refuses: `Output validation error` for the listing
 * - `"id": "5"`, `"name": 42`, `"isPrivate": "yes"` — the same, per field
 * - a `/collections` or `/rss` answer that is an object rather than an array
 *
 * So every record is read here, field by field, into the shape the rest of the
 * code assumes. A field of the wrong type is *absent*, not fatal; a list entry
 * that is not an object is counted and skipped, so one bad entry does not cost
 * the model the ninety-nine good ones; every string is cleaned and bounded on
 * the way in. Nothing here throws except the one case where a detail endpoint's
 * whole answer is not an object, where answering `{}` would hide the problem.
 */

import { cleanText, redactUrl } from './text.js';
import type {
  RawCollection,
  RawCollectionMember,
  RawLink,
  RawRssSubscription,
  RawTag,
} from './shape.js';

/**
 * Hard ceiling on a single string carried out of a record.
 *
 * The visible per-field caps live in `shape.ts` (a name is 300 characters, a
 * description 1000) and produce a sentence naming the follow-up call. This is
 * the ceiling behind them: `get_link_content`'s article text is deliberately
 * uncapped there and bounded by `max_chars` instead, and everything else should
 * never reach a length where the result budget has to work at all.
 */
const MAX_FIELD_CHARS = 100_000;
const MAX_URL_CHARS = 4096;
const MAX_TIMESTAMP_CHARS = 64;

export function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A cleaned string, cut at `max` characters with a note. */
export function stringOf(
  value: unknown,
  max = MAX_FIELD_CHARS
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = cleanText(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).toWellFormed()}… (${clean.length - max} more characters omitted)`;
}

/**
 * A cleaned string of any length — the preserved article text, which
 * `get_link_content` slices to `max_chars` itself.
 */
export function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? cleanText(value) : undefined;
}

/** A finite number; `-0` becomes `0` so both result channels say the same. */
export function finiteNumberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value + 0
    : undefined;
}

export function safeIntegerOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value + 0
    : undefined;
}

/**
 * A Linkwarden database id: a positive safe integer. Ids are echoed into
 * request paths and into confirmation sentences, so anything else is absent.
 */
export function idOf(value: unknown): number | undefined {
  const number = safeIntegerOf(value);
  return number !== undefined && number > 0 ? number : undefined;
}

export function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** A URL the instance stored, bounded and with any credentials removed. */
export function urlOf(value: unknown): string | undefined {
  const text = stringOf(value, MAX_URL_CHARS);
  return text === undefined ? undefined : redactUrl(text);
}

/** Drops the `undefined` slots, so an absent field is absent. */
function defined<T extends object>(record: {
  [K in keyof T]: T[K] | undefined;
}): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as T;
}

/**
 * `_count`, as Prisma renders it. Only `links` is read, and only as a count:
 * it is quoted into the sentence a person reads before deleting a collection.
 */
function readCount(value: unknown): { links?: number } | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  const links = safeIntegerOf(record.links);
  return links === undefined ? undefined : { links };
}

export function readTag(value: unknown): RawTag | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  return defined<RawTag>({
    id: idOf(record.id),
    name: stringOf(record.name),
    // Tri-state on purpose: `null` means "inherit the account default", which
    // is not `false`, so an explicit null survives and anything else is absent.
    archiveAsScreenshot: nullableBoolean(record.archiveAsScreenshot),
    archiveAsMonolith: nullableBoolean(record.archiveAsMonolith),
    archiveAsPDF: nullableBoolean(record.archiveAsPDF),
    archiveAsReadable: nullableBoolean(record.archiveAsReadable),
    archiveAsWaybackMachine: nullableBoolean(record.archiveAsWaybackMachine),
    aiTag: nullableBoolean(record.aiTag),
    aiGenerated: booleanOf(record.aiGenerated),
    createdAt: stringOf(record.createdAt, MAX_TIMESTAMP_CHARS),
    updatedAt: stringOf(record.updatedAt, MAX_TIMESTAMP_CHARS),
    _count: readCount(record._count),
  });
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  return booleanOf(value);
}

function readMember(value: unknown): RawCollectionMember | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  const userId = idOf(record.userId);
  if (userId === undefined) return undefined;
  return {
    userId,
    canCreate: booleanOf(record.canCreate) ?? false,
    canUpdate: booleanOf(record.canUpdate) ?? false,
    canDelete: booleanOf(record.canDelete) ?? false,
  };
}

export function readCollection(value: unknown): RawCollection | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  return defined<RawCollection>({
    id: idOf(record.id),
    name: stringOf(record.name),
    description: stringOf(record.description),
    color: stringOf(record.color, 100),
    icon: record.icon === null ? null : stringOf(record.icon, 200),
    iconWeight:
      record.iconWeight === null ? null : stringOf(record.iconWeight, 100),
    parentId: record.parentId === null ? null : idOf(record.parentId),
    isPublic: booleanOf(record.isPublic),
    ownerId: idOf(record.ownerId),
    members: Array.isArray(record.members)
      ? record.members
          .map(readMember)
          .filter(
            (member): member is RawCollectionMember => member !== undefined
          )
      : undefined,
    createdAt: stringOf(record.createdAt, MAX_TIMESTAMP_CHARS),
    updatedAt: stringOf(record.updatedAt, MAX_TIMESTAMP_CHARS),
    _count: readCount(record._count),
  });
}

/**
 * A preservation path. Linkwarden writes the sentinel `unavailable` when an
 * attempt failed, and `shape.ts` compares against it — so the value has to be
 * a string or absent, never a number that happens to be truthy.
 */
function pathOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  return stringOf(value, 4096);
}

export function readLink(value: unknown): RawLink | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  return defined<RawLink>({
    id: idOf(record.id),
    name: stringOf(record.name),
    type: stringOf(record.type, 100),
    url: record.url === null ? null : urlOf(record.url),
    description: stringOf(record.description),
    collectionId: idOf(record.collectionId),
    collection: readCollection(record.collection),
    tags: Array.isArray(record.tags)
      ? record.tags
          .map(readTag)
          .filter((tag): tag is RawTag => tag !== undefined)
      : undefined,
    pinnedBy: Array.isArray(record.pinnedBy)
      ? record.pinnedBy
          .map((entry) => objectOf(entry))
          .filter(
            (entry): entry is Record<string, unknown> => entry !== undefined
          )
          .map((entry) => defined<{ id?: number }>({ id: idOf(entry.id) }))
      : undefined,
    icon: record.icon === null ? null : stringOf(record.icon, 200),
    iconWeight:
      record.iconWeight === null ? null : stringOf(record.iconWeight, 100),
    color: record.color === null ? null : stringOf(record.color, 100),
    image: pathOf(record.image),
    pdf: pathOf(record.pdf),
    readable: pathOf(record.readable),
    monolith: pathOf(record.monolith),
    aiTagged: booleanOf(record.aiTagged),
    lastPreserved:
      record.lastPreserved === null
        ? null
        : stringOf(record.lastPreserved, MAX_TIMESTAMP_CHARS),
    importDate:
      record.importDate === null
        ? null
        : stringOf(record.importDate, MAX_TIMESTAMP_CHARS),
    createdAt: stringOf(record.createdAt, MAX_TIMESTAMP_CHARS),
    updatedAt: stringOf(record.updatedAt, MAX_TIMESTAMP_CHARS),
  });
}

export function readRssSubscription(
  value: unknown
): RawRssSubscription | undefined {
  const record = objectOf(value);
  if (record === undefined) return undefined;
  const collection = objectOf(record.collection);
  const collectionName =
    collection === undefined ? undefined : stringOf(collection.name);
  return defined<RawRssSubscription>({
    id: idOf(record.id),
    name: stringOf(record.name),
    url: urlOf(record.url),
    collectionId: idOf(record.collectionId),
    collection:
      collectionName === undefined ? undefined : { name: collectionName },
    lastBuildDate:
      record.lastBuildDate === null
        ? null
        : stringOf(record.lastBuildDate, MAX_TIMESTAMP_CHARS),
    createdAt: stringOf(record.createdAt, MAX_TIMESTAMP_CHARS),
  });
}

/** The account behind the token, as `GET /users/me` renders it. */
export interface ReadUser {
  id?: number;
  username?: string | null;
  name?: string | null;
  isPrivate?: boolean;
  archiveAsScreenshot?: boolean;
  archiveAsMonolith?: boolean;
  archiveAsPDF?: boolean;
  archiveAsReadable?: boolean;
  archiveAsWaybackMachine?: boolean;
  aiTaggingMethod?: string;
  aiPredefinedTags?: string[];
  preventDuplicateLinks?: boolean;
  hasUnIndexedLinks?: boolean;
}

export function readUser(value: unknown): ReadUser {
  const record = objectOf(value) ?? {};
  return defined<ReadUser>({
    id: idOf(record.id),
    username: record.username === null ? null : stringOf(record.username, 300),
    name: record.name === null ? null : stringOf(record.name, 300),
    isPrivate: booleanOf(record.isPrivate),
    archiveAsScreenshot: booleanOf(record.archiveAsScreenshot),
    archiveAsMonolith: booleanOf(record.archiveAsMonolith),
    archiveAsPDF: booleanOf(record.archiveAsPDF),
    archiveAsReadable: booleanOf(record.archiveAsReadable),
    archiveAsWaybackMachine: booleanOf(record.archiveAsWaybackMachine),
    aiTaggingMethod: stringOf(record.aiTaggingMethod, 100),
    aiPredefinedTags: Array.isArray(record.aiPredefinedTags)
      ? record.aiPredefinedTags
          .map((entry) => stringOf(entry, 300))
          .filter((entry): entry is string => entry !== undefined)
          .slice(0, 200)
      : undefined,
    preventDuplicateLinks: booleanOf(record.preventDuplicateLinks),
    hasUnIndexedLinks: booleanOf(record.hasUnIndexedLinks),
  });
}

/** The preservation queue counters. Every one of them is `z.number().int()`. */
export interface ReadWorkerStats {
  link: { pending: number; done: number; failed: number };
  search: { pending: number; done: number };
}

export function readWorkerStats(value: unknown): ReadWorkerStats {
  const record = objectOf(value) ?? {};
  const link = objectOf(record.link) ?? {};
  const search = objectOf(record.search) ?? {};
  return {
    link: {
      pending: safeIntegerOf(link.pending) ?? 0,
      done: safeIntegerOf(link.done) ?? 0,
      failed: safeIntegerOf(link.failed) ?? 0,
    },
    search: {
      pending: safeIntegerOf(search.pending) ?? 0,
      done: safeIntegerOf(search.done) ?? 0,
    },
  };
}

/** The readable archive Linkwarden stores, as Mozilla Readability wrote it. */
export interface ReadArticle {
  title?: string;
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  lang?: string;
  excerpt?: string;
  textContent: string;
}

export function readArticle(value: unknown): ReadArticle {
  const record = objectOf(value) ?? {};
  return {
    ...defined<Omit<ReadArticle, 'textContent'>>({
      title: stringOf(record.title),
      byline: stringOf(record.byline),
      siteName: stringOf(record.siteName),
      publishedTime: stringOf(record.publishedTime),
      lang: stringOf(record.lang),
      excerpt: stringOf(record.excerpt),
    }),
    textContent: textOf(record.textContent) ?? '',
  };
}

/** A list of records, with the entries that were not readable counted. */
function readList<T>(
  value: unknown,
  read: (entry: unknown) => T | undefined
): { items: T[]; skipped: number } {
  const items: T[] = [];
  let skipped = 0;
  for (const entry of arrayOf(value)) {
    const item = read(entry);
    if (item === undefined) {
      skipped++;
      continue;
    }
    items.push(item);
  }
  return { items, skipped };
}

export function readLinks(value: unknown): {
  items: RawLink[];
  skipped: number;
} {
  return readList(value, readLink);
}

export function readCollections(value: unknown): {
  items: RawCollection[];
  skipped: number;
} {
  return readList(value, readCollection);
}

export function readTags(value: unknown): { items: RawTag[]; skipped: number } {
  return readList(value, readTag);
}

export function readRssSubscriptions(value: unknown): {
  items: RawRssSubscription[];
  skipped: number;
} {
  return readList(value, readRssSubscription);
}

/**
 * A page of a listing route: the entries and the cursor to continue from.
 *
 * The cursor is passed back to the instance verbatim on the next call and is
 * declared `z.number().int()` in the output schema, so a value that is not a
 * safe integer — `1e999` parses to `Infinity`, `1.5` is not an integer — is
 * reported as the end of the list rather than as a broken answer.
 */
export function cursorOf(value: unknown): number | null {
  return idOf(value) ?? null;
}

function describeKind(value: unknown): string {
  if (value === null || value === undefined) return 'an empty body';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value} value`;
}

/**
 * A record from a detail endpoint. Throws when the answer is not an object at
 * all — a proxy's login page answered with status 200, say — because reading it
 * as `{}` would report an empty record instead of the actual problem.
 */
export function recordOf(
  value: unknown,
  what: string
): Record<string, unknown> {
  const record = objectOf(value);
  if (record === undefined) {
    throw new Error(
      `Linkwarden returned ${describeKind(value)} instead of ${what}. ` +
        'Check that LINKWARDEN_URL points at the Linkwarden instance itself and not at a proxy or login page.'
    );
  }
  return record;
}

/** The note a listing adds for the entries it could not read. */
export function skippedNote(skipped: number, noun: string): string | undefined {
  return skipped > 0
    ? `${skipped} ${noun}(s) in the answer were not readable records and were skipped.`
    : undefined;
}
