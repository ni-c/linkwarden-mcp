import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/client';

import {
  bareJsonResponse,
  connect,
  dataResponse,
  envelopeResponse,
  linkFixture,
  readabilityFixture,
  resultJson,
  resultText,
  stubFetch,
  tagFixture,
} from './harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * What `JSON.parse` makes of `1e999`. Written as a parse rather than as a
 * literal: the literal is `Infinity` to the compiler, and the point is the
 * value that arrives over the wire.
 */
const INFINITY = JSON.parse('1e999') as number;

/**
 * What an instance can send, and what it used to cost.
 *
 * Every one of these was a whole answer lost: a `TypeError` out of a
 * projection, or the SDK refusing `structuredContent` against the schema the
 * tool declares ("Output validation error"). None of them is exotic — they are
 * the JSON of a Linkwarden a version ahead, of a reverse proxy in front of it,
 * or of whatever a mistyped `LINKWARDEN_URL` reaches.
 *
 * The assertion is the same throughout: the tool answers, the answer is not an
 * error, and the good part of the record survives.
 */

function noFailureText(result: CallToolResult): void {
  const text = resultText(result);
  expect(result.isError).toBeFalsy();
  expect(text).not.toMatch(/Output validation error/);
  expect(text).not.toMatch(/is not a function/);
  expect(text).not.toMatch(/Cannot read properties/);
}

describe('what the instance sends is read, not cast', () => {
  it('answers a listing whose links are an object rather than an array', async () => {
    stubFetch(() => dataResponse({ links: {}, nextCursor: null }));
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_links',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    expect(resultJson(result).count).toBe(0);
  });

  it('skips a null entry and counts it, keeping the rest of the page', async () => {
    stubFetch(() =>
      dataResponse({ links: [null, linkFixture()], nextCursor: null })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_links',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    const body = resultJson(result);
    expect(body.count).toBe(1);
    expect((body.notes as string[]).join(' ')).toMatch(/1 link\(s\)/);
  });

  it('reads a link whose tags are an object as a link without tags', async () => {
    stubFetch(() =>
      dataResponse({
        links: [linkFixture({ tags: { nope: true } })],
        nextCursor: null,
      })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_links',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    const links = resultJson(result).links as Record<string, unknown>[];
    expect(links[0]?.tags).toEqual([]);
  });

  it.each([
    ['1e999, which JSON.parse reads as Infinity', INFINITY],
    ['a fraction', 1.5],
    ['a string', '12'],
    ['null', null],
  ])('reports a cursor that is %s as the end of the list', async (_, value) => {
    stubFetch(() => dataResponse({ links: [], nextCursor: value }));
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_links',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    expect(resultJson(result).next_cursor).toBeNull();
  });

  it('drops an id and a name of the wrong type instead of the whole page', async () => {
    stubFetch(() =>
      dataResponse({
        links: [linkFixture({ id: '5', name: 42 })],
        nextCursor: null,
      })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_links',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    const links = resultJson(result).links as Record<string, unknown>[];
    expect(links[0]).not.toHaveProperty('id');
    expect(links[0]?.name).toBeUndefined();
    // And the rest of the record is still there.
    expect(links[0]?.url).toBe('https://example.net/article');
  });

  it('answers a collections route that returns an object', async () => {
    stubFetch(() => envelopeResponse({}));
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_collections',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    expect(resultJson(result).count).toBe(0);
  });

  it('reads a collection whose members are an object as one without members', async () => {
    stubFetch(() => envelopeResponse({ id: 7, name: 'X', members: {} }));
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_collection',
      arguments: { collection_id: 7 },
    })) as CallToolResult;
    noFailureText(result);
    const collection = resultJson(result).collection as Record<string, unknown>;
    expect(collection).not.toHaveProperty('members');
  });

  it('drops a member without a usable user id', async () => {
    stubFetch(() =>
      envelopeResponse({
        id: 7,
        name: 'X',
        members: [{ userId: 'nine', canCreate: true }, { userId: 2 }],
      })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_collection',
      arguments: { collection_id: 7 },
    })) as CallToolResult;
    noFailureText(result);
    const collection = resultJson(result).collection as {
      members: { userId: number }[];
    };
    expect(collection.members).toEqual([
      { userId: 2, canCreate: false, canUpdate: false, canDelete: false },
    ]);
  });

  it('answers an rss route that returns an object', async () => {
    stubFetch(() => envelopeResponse({}));
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_rss_subscriptions',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    expect(resultJson(result).count).toBe(0);
  });

  it.each([
    ['a fractional id', { id: 1.5 }],
    ['a numeric name', { name: 5 }],
    ['a string where a flag belongs', { isPrivate: 'yes' }],
    ['a predefined tag list of numbers', { aiPredefinedTags: [1, 2] }],
  ])('answers get_current_user with %s', async (_, overrides) => {
    stubFetch(() => envelopeResponse({ id: 1, name: 'u', ...overrides }));
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_current_user',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
  });

  it.each([
    ['1e999', INFINITY],
    ['a fraction', 1.5],
    ['a string', 'many'],
  ])('answers get_worker_stats with a %s counter', async (_, value) => {
    stubFetch(() =>
      dataResponse({
        link: { pending: value, done: 1, failed: 0 },
        search: { pending: 0, done: 0 },
      })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_worker_stats',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    const links = resultJson(result).links as Record<string, number>;
    expect(links.pending).toBe(0);
  });

  it('answers list_tags when the page is not a record', async () => {
    stubFetch(() => dataResponse([]));
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_tags',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    expect(resultJson(result).count).toBe(0);
  });

  it('reads a tag count of the wrong type as absent', async () => {
    stubFetch(() =>
      dataResponse({ tags: [tagFixture({ _count: { links: 'many' } })] })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_tags',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    const tags = resultJson(result).tags as Record<string, unknown>[];
    expect(tags[0]).not.toHaveProperty('linkCount');
  });

  it('says which value it got when a detail route answers with a scalar', async () => {
    stubFetch(() => envelopeResponse(12));
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_link',
      arguments: { link_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/instead of link 1/);
    expect(resultText(result)).toMatch(/LINKWARDEN_URL/);
  });

  it('reads a readable archive whose textContent is a number', async () => {
    let call = 0;
    stubFetch(() => {
      call++;
      return call === 1
        ? envelopeResponse(linkFixture())
        : bareJsonResponse(readabilityFixture({ textContent: 5, title: 9 }));
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42 },
    })) as CallToolResult;
    noFailureText(result);
    const body = resultJson(result);
    expect(body.text).toBe('');
    expect(body.total_chars).toBe(0);
    expect(body.title).toBeNull();
  });

  it('strips control characters out of the preserved text', async () => {
    let call = 0;
    // Built at runtime rather than spelled as an escape: an editing tool turns
    // the escape into the raw byte, which is the thing this test is about.
    const esc = String.fromCharCode(27);
    stubFetch(() => {
      call++;
      return call === 1
        ? envelopeResponse(linkFixture())
        : bareJsonResponse(
            readabilityFixture({ textContent: `before${esc}[31mafter` })
          );
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42 },
    })) as CallToolResult;
    noFailureText(result);
    expect(resultText(result)).not.toContain(esc);
    expect(resultJson(result).text).toBe('before[31mafter');
  });
});

describe('a listing is shortened, not refused', () => {
  it('answers a page of large links with a shortened page', async () => {
    // Every field within its own cap and still far past the result budget:
    // 100 links of 300-character titles, 480-character URLs and
    // 1000-character descriptions. This used to answer
    // `ResultTooLargeError` — the shortener behind every read tool could only
    // halve a top-level string, and a listing has none.
    const links = Array.from({ length: 100 }, (_, i) =>
      linkFixture({
        id: i + 1,
        name: 'n'.repeat(300),
        url: `https://example.net/${'u'.repeat(480)}`,
        description: 'd'.repeat(1000),
      })
    );
    stubFetch(() => dataResponse({ links, nextCursor: null }));
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_links',
      arguments: {},
    })) as CallToolResult;
    noFailureText(result);
    const body = resultJson(result);
    expect((body.links as unknown[]).length).toBeGreaterThan(0);
    expect((body.links as unknown[]).length).toBeLessThan(100);
    expect(body.truncated).toBeTruthy();
    // And the follow-up is a sentence a caller can act on, not "cursor=null".
    expect(resultText(result)).not.toMatch(/cursor=null/);
  });
});
