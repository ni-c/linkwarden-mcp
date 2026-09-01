import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  ArchivedFormat,
  collectionId,
  cursor,
  linkId,
  linkSort,
  linkSortValue,
  idPath,
  tagId,
  withQuery,
} from '../schema.js';
import {
  Notes,
  preservedFormats,
  shapeLink,
  UNTRUSTED_METADATA_NOTE,
  type RawLink,
} from '../shape.js';

import type { LinkwardenApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { jsonResult, run, textResult, untrustedResult } from '../result.js';

/**
 * Upper bound on the links returned in one call. Linkwarden itself pages at
 * PAGINATION_TAKE_COUNT (50 by default), but that is instance-configurable and an
 * instance with it set high must not be able to flood a single result.
 */
const MAX_LINKS = 100;

/** Default and maximum characters of preserved article text per call. */
const DEFAULT_CONTENT_CHARS = 20_000;
const MAX_CONTENT_CHARS = 100_000;

/** Field prefixes Linkwarden's query parser understands. */
const SEARCH_FIELDS = [
  'url',
  'name',
  'description',
  'type',
  'collection',
  'pinned',
  'public',
  'before',
  'after',
  'tag',
];

/** Matches a `field:` or `!field:` token anywhere in a query. */
const FIELD_FILTER_RE = new RegExp(`(^|\\s)!?(${SEARCH_FIELDS.join('|')}):`);

const SEARCH_SYNTAX = [
  'Plain text matches the title, URL, description and tag names of a link.',
  '',
  'IMPORTANT: the field-filter syntax below only works on instances that run',
  'Meilisearch. Linkwarden parses those filters exclusively in its Meilisearch',
  'branch; without it the whole query is matched as one literal substring, so',
  '`tag:news` searches for the characters "tag:news" and finds nothing. Use the',
  'collection_id, tag_id and pinned_only arguments instead — those are applied by',
  'the database and work either way. list_collections and list_tags give you the ids.',
  '',
  'Where Meilisearch is available the filters are:',
  '  url:  name:  description:  type:  collection:  tag:  pinned:  public:  before:  after:',
  '',
  'These filters match the WHOLE value, not a substring. `name:Report` does not',
  'find a link called "Quarterly Report" — it finds one whose title is exactly',
  '"Report". Quote values that contain spaces: name:"Quarterly Report". An empty',
  'result from a field filter therefore usually means the value was a fragment,',
  'not that the filter is unsupported. Plain text without a filter DOES match',
  'substrings, so search for the fragment on its own when unsure.',
  '',
  'Prefix a filter with ! to negate it, e.g. !tag:archive. pinned: and public:',
  'take true or false; before: and after: take a date such as 2026-01-31. If the',
  'instance sets SEARCH_FILTER_LIMIT, field filters beyond that count are dropped',
  'silently, so prefer few, specific filters.',
].join('\n');

export function registerLinkReadTools(
  server: McpServer,
  api: LinkwardenApi
): void {
  server.registerTool(
    'search_links',
    {
      title: 'Search and list links',
      description:
        'Searches bookmarks, or lists them when no query is given. This is the way ' +
        'to find links — there is no separate list tool, and the older /links ' +
        'listing route is deprecated upstream.\n\n' +
        `${SEARCH_SYNTAX}\n\n` +
        'Returns at most ' +
        `${MAX_LINKS} links plus a next_cursor for the following page. Article text ` +
        'is not included; use get_link_content for that.\n\n' +
        'Indexing is asynchronous where Meilisearch is used: a link created ' +
        'moments ago is not searchable yet. An empty result straight after a ' +
        'write means the index has not caught up, not that the write failed — ' +
        'get_link by id confirms it exists.',
      inputSchema: z.object({
        query: z
          .string()
          .max(2048)
          .optional()
          .describe('Search query, see the syntax above. Omit to list links.'),
        collection_id: collectionId
          .optional()
          .describe('Restrict the result to this collection'),
        tag_id: tagId.optional().describe('Restrict the result to this tag'),
        pinned_only: z
          .boolean()
          .optional()
          .describe('Only return links pinned by the authenticated account'),
        sort: linkSort,
        cursor,
      }),
      annotations: READ_ONLY,
    },
    async ({ query, collection_id, tag_id, pinned_only, sort, cursor: from }) =>
      run(async () => {
        const path = withQuery('/search', {
          searchQueryString: query,
          collectionId: collection_id,
          tagId: tag_id,
          pinnedOnly: pinned_only,
          sort: linkSortValue(sort),
          cursor: from,
        });
        const payload = await api.get(path);

        // When Meilisearch is enabled and matches nothing, the route answers with
        // `data: []` instead of the usual `{ links, nextCursor }` object.
        const empty = Array.isArray(payload);
        const result = empty
          ? { links: [] as RawLink[], nextCursor: null }
          : (payload as { links?: RawLink[]; nextCursor?: number | null });

        const links = (result.links ?? []).slice(0, MAX_LINKS);
        const notes = new Notes();
        notes.add(UNTRUSTED_METADATA_NOTE);
        if ((result.links ?? []).length > MAX_LINKS) {
          notes.add(
            `The instance returned more than ${MAX_LINKS} links; only the first ${MAX_LINKS} are shown. Narrow the query.`
          );
        }
        const nextCursor = empty ? null : (result.nextCursor ?? null);
        if (nextCursor !== null) {
          notes.add(
            `More links exist: call search_links again with the same arguments and cursor=${nextCursor}.`
          );
        }
        // A field filter that found nothing is the signature of an instance
        // without Meilisearch: the query was then matched as a literal substring,
        // so "tag:news" looked for those nine characters. There is no way to ask
        // the API whether Meilisearch is active, so say it whenever it could apply
        // rather than let an empty result read as "no such links".
        if (query !== undefined && FIELD_FILTER_RE.test(query)) {
          notes.add(
            links.length === 0
              ? 'The query uses field filters (field:value) and found nothing. Those only work ' +
                  'on instances running Meilisearch; otherwise the whole query is matched as a ' +
                  'literal substring. Retry with plain search terms, or filter structurally via ' +
                  'the collection_id, tag_id and pinned_only arguments.'
              : 'The query uses field filters (field:value), which only work on instances ' +
                  'running Meilisearch. If the result looks wrong, filter via the collection_id, ' +
                  'tag_id and pinned_only arguments instead.'
          );
        }

        return jsonResult(
          {
            count: links.length,
            next_cursor: nextCursor,
            links: links.map(shapeLink),
            notes: notes.list(),
          },
          nextCursor === undefined
            ? 'Narrow the query with collection_id, tag_id or pinned_only.'
            : `Call search_links again with cursor=${nextCursor} for the next page.`
        );
      })
  );

  server.registerTool(
    'get_link',
    {
      title: 'Get a link',
      description:
        'Fetches one bookmark with its tags, collection and which preserved ' +
        'formats exist. Does not include the archived page text — use ' +
        'get_link_content for that.',
      inputSchema: z.object({ link_id: linkId }),
      annotations: READ_ONLY,
    },
    async ({ link_id }) =>
      run(async () => {
        const link = (await api.get(idPath('/links', link_id))) as RawLink;
        return jsonResult({
          link: shapeLink(link),
          notes: [UNTRUSTED_METADATA_NOTE],
        });
      })
  );

  server.registerTool(
    'get_link_content',
    {
      title: 'Read the preserved text of a link',
      description:
        'Returns the readable article text Linkwarden extracted and stored when it ' +
        'preserved the page, so a saved bookmark can be read without fetching the ' +
        'live site. Only the readable format is served: the screenshot, PDF and ' +
        'single-file HTML archives are binary or raw markup and are not useful as ' +
        'text.\n\n' +
        'Long articles are returned in slices — pass the offset from the previous ' +
        'result to continue. If the link has no readable archive, the tool says so ' +
        'and represerve_link can create one.\n\n' +
        'Preservation is asynchronous: Linkwarden queues the page and a worker ' +
        'drives a headless browser over it, which takes minutes. A link created ' +
        'moments ago has no readable archive yet, and that is not an error — ' +
        'get_worker_stats shows the queue.',
      inputSchema: z.object({
        link_id: linkId,
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Character offset to start at, default 0'),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(MAX_CONTENT_CHARS)
          .optional()
          .describe(
            `Maximum characters to return, default ${DEFAULT_CONTENT_CHARS}`
          ),
      }),
      annotations: READ_ONLY,
    },
    async ({ link_id, offset, max_chars }) =>
      run(async () => {
        // Check the link first: it says whether a readable archive exists at all,
        // which turns the common failure into an explanation instead of a 404.
        const link = (await api.get(idPath('/links', link_id))) as RawLink;
        const available = preservedFormats(link);
        if (!available.readable) {
          const others = Object.entries(available)
            .filter(([, exists]) => exists)
            .map(([format]) => format);
          return textResult(
            `Link ${link_id} has no readable archive.` +
              (others.length > 0
                ? ` Preserved formats that do exist: ${others.join(', ')} — those are binary or raw HTML and cannot be read as text.`
                : ' No format has been preserved for it yet.') +
              ' Call represerve_link to have Linkwarden archive the page again,' +
              ' then retry once the worker has finished (get_worker_stats shows the queue).'
          );
        }

        const raw = await api.getRaw(
          withQuery(idPath('/archives', link_id), {
            format: ArchivedFormat.readability,
          })
        );
        if (!raw.contentType.includes('application/json')) {
          return textResult(
            `Linkwarden returned ${raw.contentType || 'an unknown content type'} for the readable archive of link ${link_id} instead of JSON. The archive is probably corrupt; represerve_link recreates it.`
          );
        }

        const article = JSON.parse(raw.text) as {
          title?: string;
          byline?: string | null;
          siteName?: string | null;
          publishedTime?: string | null;
          lang?: string | null;
          length?: number;
          excerpt?: string | null;
          textContent?: string;
        };

        const text = article.textContent ?? '';
        const start = offset ?? 0;
        const limit = max_chars ?? DEFAULT_CONTENT_CHARS;
        const slice = text.slice(start, start + limit);
        const end = start + slice.length;

        const notes = new Notes();
        if (end < text.length) {
          notes.add(
            `Truncated: ${end} of ${text.length} characters returned. Call get_link_content again with link_id=${link_id} and offset=${end} for the next slice.`
          );
        }
        if (start >= text.length && text.length > 0) {
          notes.add(
            `The offset is past the end of the article (${text.length} characters).`
          );
        }

        // Everything below this point was written by whoever controls the saved
        // page, so it goes out through the untrusted wrapper.
        return untrustedResult(
          {
            link_id,
            title: article.title ?? null,
            byline: article.byline ?? null,
            site_name: article.siteName ?? null,
            published_time: article.publishedTime ?? null,
            language: article.lang ?? null,
            excerpt: article.excerpt ?? null,
            total_chars: text.length,
            offset: start,
            returned_chars: slice.length,
            text: slice,
            notes: notes.list(),
          },
          `call get_link_content with link_id=${link_id}, offset=${end} and a smaller max_chars`
        );
      })
  );
}
