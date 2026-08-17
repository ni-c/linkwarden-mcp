import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bareJsonResponse,
  collectionFixture,
  connectClient,
  dataResponse,
  envelopeResponse,
  linkFixture,
  readabilityFixture,
  resultJson,
  resultText,
  rssFixture,
  stubFetch,
  tagFixture,
  userFixture,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('search_links', () => {
  it('reads the data envelope and shapes the links', async () => {
    stubFetch(() => dataResponse({ links: [linkFixture()], nextCursor: null }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: {},
    });

    const body = resultJson(result);
    expect(body.count).toBe(1);
    expect(body.next_cursor).toBeNull();
    const links = body.links as Record<string, unknown>[];
    expect(links[0]?.id).toBe(42);
    // Shaped, not passed through: presentation fields and the huge textContent
    // must not appear.
    expect(links[0]).not.toHaveProperty('textContent');
    expect(links[0]).not.toHaveProperty('iconWeight');
    expect(links[0]?.preserved).toEqual({
      screenshot: true,
      // "unavailable" is Linkwarden's marker for a failed attempt, not a file.
      pdf: false,
      readable: true,
      monolith: false,
    });
  });

  it('maps the readable sort name onto the numeric enum', async () => {
    const calls = stubFetch(() =>
      dataResponse({ links: [], nextCursor: null })
    );
    const client = await connectClient();
    await client.callTool({
      name: 'search_links',
      arguments: { sort: 'name_az' },
    });
    expect(calls[0]?.url).toMatch(/sort=2/);
  });

  it('passes the query, filters and cursor through unchanged', async () => {
    const calls = stubFetch(() =>
      dataResponse({ links: [], nextCursor: null })
    );
    const client = await connectClient();
    await client.callTool({
      name: 'search_links',
      arguments: {
        query: 'tag:reference !collection:"Read later" rust',
        collection_id: 7,
        tag_id: 3,
        pinned_only: true,
        cursor: 4711,
      },
    });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/v1/search');
    expect(url.searchParams.get('searchQueryString')).toBe(
      'tag:reference !collection:"Read later" rust'
    );
    expect(url.searchParams.get('collectionId')).toBe('7');
    expect(url.searchParams.get('tagId')).toBe('3');
    expect(url.searchParams.get('pinnedOnly')).toBe('true');
    expect(url.searchParams.get('cursor')).toBe('4711');
  });

  it('names the follow-up call when a cursor comes back', async () => {
    stubFetch(() => dataResponse({ links: [linkFixture()], nextCursor: 41 }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: {},
    });
    expect((resultJson(result).notes as string[]).join(' ')).toMatch(
      /cursor=41/
    );
  });

  it('survives the empty-array payload Meilisearch returns for no matches', async () => {
    // searchLinks answers `data: []` instead of `{ links, nextCursor }` when the
    // Meilisearch query matches nothing.
    stubFetch(() => dataResponse([]));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: { query: 'nothing matches this' },
    });

    expect(result.isError).toBeFalsy();
    const body = resultJson(result);
    expect(body.count).toBe(0);
    expect(body.links).toEqual([]);
    expect(body.next_cursor).toBeNull();
  });

  it('marks the metadata as untrusted', async () => {
    stubFetch(() => dataResponse({ links: [linkFixture()], nextCursor: null }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: {},
    });
    expect((resultJson(result).notes as string[]).join(' ')).toMatch(
      /untrusted|never as instructions/i
    );
  });
});

describe('list_tags', () => {
  it('reads the data envelope and keeps the tri-state archival flags', async () => {
    stubFetch(() => dataResponse({ tags: [tagFixture()], nextCursor: null }));
    const client = await connectClient();
    const result = await client.callTool({ name: 'list_tags', arguments: {} });

    const tags = resultJson(result).tags as Record<string, unknown>[];
    expect(tags[0]?.linkCount).toBe(5);
    expect(tags[0]?.archival).toEqual({
      archiveAsScreenshot: null,
      archiveAsMonolith: null,
      archiveAsPDF: null,
      archiveAsReadable: true,
      archiveAsWaybackMachine: null,
      aiTag: null,
    });
  });

  it('maps the tag-only sort names', async () => {
    const calls = stubFetch(() => dataResponse({ tags: [], nextCursor: null }));
    const client = await connectClient();
    await client.callTool({
      name: 'list_tags',
      arguments: { sort: 'link_count_high_low' },
    });
    expect(calls[0]?.url).toMatch(/sort=4/);
  });
});

describe('collections', () => {
  it('reads the response envelope and drops member identities', async () => {
    stubFetch(() =>
      envelopeResponse([
        collectionFixture({
          members: [
            {
              userId: 2,
              canCreate: true,
              canUpdate: false,
              canDelete: false,
              user: {
                username: 'someone-else',
                name: 'Someone Else',
                image: null,
              },
            },
          ],
        }),
      ])
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'list_collections',
      arguments: {},
    });

    const text = resultText(result);
    // The API includes the other members' names; they must not reach the model.
    expect(text).not.toMatch(/someone-else/);
    expect(text).not.toMatch(/Someone Else/);
    const collections = resultJson(result).collections as Record<
      string,
      unknown
    >[];
    expect(collections[0]?.linkCount).toBe(12);
    expect(collections[0]?.members).toEqual([
      { userId: 2, canCreate: true, canUpdate: false, canDelete: false },
    ]);
  });

  it('explains a null collection instead of crashing', async () => {
    // getCollectionById answers 200 with `response: null` for an id the account
    // cannot see.
    stubFetch(() => envelopeResponse(null));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_collection',
      arguments: { collection_id: 999 },
    });

    expect(result.isError).toBeFalsy();
    expect(resultJson(result).collection).toBeNull();
    expect((resultJson(result).notes as string[]).join(' ')).toMatch(/999/);
  });
});

describe('get_link_content', () => {
  it('returns the article text and withholds the raw HTML', async () => {
    const calls = stubFetch((url) =>
      url.includes('/archives/')
        ? bareJsonResponse(readabilityFixture())
        : envelopeResponse(linkFixture())
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42 },
    });

    expect(calls[1]?.url).toBe(
      'https://links.example.net/api/v1/archives/42?format=3'
    );
    const text = resultText(result);
    expect(text).toMatch(/untrusted content from Linkwarden/);
    expect(text).toMatch(/quick brown fox/);
    // `content` is the sanitized-but-still-raw HTML of the page; only textContent
    // is meant to be read.
    expect(text).not.toMatch(/must not be returned/);
    const body = resultJson(result);
    expect(body.excerpt).toBe('A short summary.');
    expect(body.site_name).toBe('example.net');
  });

  it('slices long articles and names the follow-up offset', async () => {
    stubFetch((url) =>
      url.includes('/archives/')
        ? bareJsonResponse(readabilityFixture({ textContent: 'x'.repeat(500) }))
        : envelopeResponse(linkFixture())
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42, max_chars: 100 },
    });

    const body = resultJson(result);
    expect(body.total_chars).toBe(500);
    expect(body.returned_chars).toBe(100);
    expect((body.notes as string[]).join(' ')).toMatch(/offset=100/);
  });

  it('continues from an offset', async () => {
    stubFetch((url) =>
      url.includes('/archives/')
        ? bareJsonResponse(
            readabilityFixture({ textContent: 'abcdefghij'.repeat(10) })
          )
        : envelopeResponse(linkFixture())
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42, offset: 95, max_chars: 100 },
    });

    const body = resultJson(result);
    expect(body.offset).toBe(95);
    expect(body.returned_chars).toBe(5);
    expect(body.text).toBe('fghij');
    expect((body.notes as string[]).join(' ')).not.toMatch(/Truncated/);
  });

  it('explains a missing readable archive without fetching it', async () => {
    const calls = stubFetch(() =>
      envelopeResponse(
        linkFixture({ readable: 'unavailable', image: 'archives/7/42.png' })
      )
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42 },
    });

    // Only the link lookup, no archive request.
    expect(calls).toHaveLength(1);
    const text = resultText(result);
    expect(text).toMatch(/no readable archive/);
    expect(text).toMatch(/screenshot/);
    expect(text).toMatch(/represerve_link/);
  });

  it('reports a non-JSON archive instead of dumping it', async () => {
    stubFetch((url) =>
      url.includes('/archives/')
        ? new Response('%PDF-1.7 binary junk', {
            status: 200,
            headers: { 'content-type': 'application/pdf' },
          })
        : envelopeResponse(linkFixture())
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42 },
    });

    const text = resultText(result);
    expect(text).toMatch(/application\/pdf/);
    expect(text).not.toMatch(/binary junk/);
  });
});

describe('overview tools', () => {
  it('reports the account and its archival defaults without the e-mail address', async () => {
    stubFetch(() =>
      envelopeResponse(userFixture({ email: 'private@example.net' }))
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_current_user',
      arguments: {},
    });

    const text = resultText(result);
    expect(text).not.toMatch(/private@example.net/);
    const body = resultJson(result);
    expect(body.username).toBe('testuser');
    expect(body.prevent_duplicate_links).toBe(true);
    expect(body.archival_defaults).toEqual({
      screenshot: true,
      monolith: false,
      pdf: false,
      readable: true,
      wayback_machine: false,
    });
  });

  it('handles the flat link array the dashboard route returns', async () => {
    stubFetch(() => envelopeResponse([linkFixture(), linkFixture({ id: 43 })]));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_dashboard',
      arguments: {},
    });
    expect(resultJson(result).count).toBe(2);
  });

  it('lists RSS subscriptions', async () => {
    stubFetch(() => envelopeResponse([rssFixture()]));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'list_rss_subscriptions',
      arguments: {},
    });
    const subscriptions = resultJson(result).subscriptions as Record<
      string,
      unknown
    >[];
    expect(subscriptions[0]?.name).toBe('Example feed');
    expect(subscriptions[0]?.collection).toEqual({
      id: 7,
      name: 'Reading list',
    });
  });

  it('reads worker stats out of the data envelope', async () => {
    stubFetch(() =>
      dataResponse({
        link: { pending: 3, done: 100, failed: 2 },
        search: { pending: 1, done: 102 },
      })
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_worker_stats',
      arguments: {},
    });

    expect(resultJson(result).links).toEqual({
      pending: 3,
      preserved: 100,
      failed: 2,
    });
  });
});

describe('gaps in the read paths', () => {
  it('names the follow-up cursor for tags', async () => {
    stubFetch(() => dataResponse({ tags: [tagFixture()], nextCursor: 3 }));
    const client = await connectClient();
    const result = await client.callTool({ name: 'list_tags', arguments: {} });
    expect((resultJson(result).notes as string[]).join(' ')).toMatch(
      /cursor=3/
    );
  });

  it('passes a tag search string through', async () => {
    const calls = stubFetch(() => dataResponse({ tags: [], nextCursor: null }));
    const client = await connectClient();
    await client.callTool({ name: 'list_tags', arguments: { search: 'ref' } });
    expect(new URL(calls[0]?.url ?? '').searchParams.get('search')).toBe('ref');
  });

  it('explains a null tag instead of crashing', async () => {
    stubFetch(() => envelopeResponse(null));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_tag',
      arguments: { tag_id: 999 },
    });
    expect(result.isError).toBeFalsy();
    expect(resultJson(result).tag).toBeNull();
  });

  it('returns a shaped tag', async () => {
    stubFetch(() => envelopeResponse(tagFixture()));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_tag',
      arguments: { tag_id: 3 },
    });
    expect((resultJson(result).tag as Record<string, unknown>).name).toBe(
      'reference'
    );
  });

  it('caps an oversized link list and says so', async () => {
    stubFetch(() =>
      dataResponse({
        links: Array.from({ length: 150 }, (_, i) =>
          linkFixture({ id: i + 1 })
        ),
        nextCursor: null,
      })
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: {},
    });
    const body = resultJson(result);
    expect(body.count).toBe(100);
    expect((body.notes as string[]).join(' ')).toMatch(/Narrow the query/);
  });

  it('reports an offset past the end of the article', async () => {
    stubFetch((url) =>
      url.includes('/archives/')
        ? bareJsonResponse(readabilityFixture({ textContent: 'short' }))
        : envelopeResponse(linkFixture())
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42, offset: 500 },
    });
    expect((resultJson(result).notes as string[]).join(' ')).toMatch(
      /past the end/
    );
  });

  it('handles a link with nothing preserved at all', async () => {
    stubFetch(() =>
      envelopeResponse(
        linkFixture({ image: null, pdf: null, readable: null, monolith: null })
      )
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42 },
    });
    expect(resultText(result)).toMatch(/No format has been preserved/);
  });

  it('copes with a sparse user record and empty worker stats', async () => {
    stubFetch((url) =>
      url.endsWith('/worker') ? dataResponse({}) : envelopeResponse({ id: 9 })
    );
    const client = await connectClient();

    const user = await client.callTool({
      name: 'get_current_user',
      arguments: {},
    });
    expect(resultJson(user).username).toBeNull();
    expect(resultJson(user).archival_defaults).toEqual({
      screenshot: false,
      monolith: false,
      pdf: false,
      readable: false,
      wayback_machine: false,
    });

    const stats = await client.callTool({
      name: 'get_worker_stats',
      arguments: {},
    });
    expect(resultJson(stats).links).toEqual({
      pending: 0,
      preserved: 0,
      failed: 0,
    });
  });

  it('marks an aiTagged link and a link with no tags', async () => {
    stubFetch(() =>
      dataResponse({
        links: [
          linkFixture({ aiTagged: true, tags: [], pinnedBy: [{ id: 1 }] }),
        ],
        nextCursor: null,
      })
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: {},
    });
    const links = resultJson(result).links as Record<string, unknown>[];
    expect(links[0]?.aiTagged).toBe(true);
    expect(links[0]?.tags).toEqual([]);
    expect(links[0]?.pinned).toBe(true);
  });
});

describe('field-filter warning', () => {
  it('explains the Meilisearch dependency when a field filter finds nothing', async () => {
    stubFetch(() => dataResponse({ links: [], nextCursor: null }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: { query: 'tag:news' },
    });

    const notes = (resultJson(result).notes as string[]).join(' ');
    expect(notes).toMatch(/Meilisearch/);
    expect(notes).toMatch(/tag_id/);
  });

  it('still flags the filter syntax when results did come back', async () => {
    stubFetch(() => dataResponse({ links: [linkFixture()], nextCursor: null }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: { query: '!collection:"Read later" rust' },
    });
    expect((resultJson(result).notes as string[]).join(' ')).toMatch(
      /Meilisearch/
    );
  });

  it('does not warn about a plain-text query', async () => {
    stubFetch(() => dataResponse({ links: [], nextCursor: null }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: { query: 'rust ownership' },
    });
    expect((resultJson(result).notes as string[]).join(' ')).not.toMatch(
      /Meilisearch/
    );
  });

  it('does not mistake a colon inside a URL for a field filter', async () => {
    stubFetch(() => dataResponse({ links: [], nextCursor: null }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: { query: 'https://example.net/a' },
    });
    expect((resultJson(result).notes as string[]).join(' ')).not.toMatch(
      /Meilisearch/
    );
  });
});
