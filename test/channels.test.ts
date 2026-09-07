import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/client';

import {
  collectionFixture,
  confirmed,
  connect,
  linkFixture,
  readabilityFixture,
  resultText,
  rssFixture,
  stubFetch,
  tagFixture,
  userFixture,
} from './harness.js';
import { ALL_TOOLS } from '../src/tools/catalogue.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The two channels of every tool, held to each other.
 *
 * A result carries the same document twice: a text block a person or a model
 * reads, and `structuredContent` a client parses. Nothing had ever asserted
 * that the two say the same thing — so a drift between them would have been
 * invisible, and the tools that differ on purpose were indistinguishable from
 * the tools that might have drifted.
 *
 * There is exactly one deliberate difference here, and it is the same one
 * everywhere: `untrustedResult` puts a paragraph in front of the JSON saying
 * that what follows is a stranger's text. Everything from the first brace on
 * must parse to `structuredContent` exactly.
 */

/** Arguments per tool, and whether it has to be driven through its token. */
const CALLS: Record<string, { args: Record<string, unknown>; guarded?: true }> =
  {
    search_links: { args: {} },
    get_link: { args: { link_id: 42 } },
    get_link_content: { args: { link_id: 42 } },
    list_collections: { args: {} },
    get_collection: { args: { collection_id: 7 } },
    list_tags: { args: {} },
    get_tag: { args: { tag_id: 3 } },
    get_current_user: { args: {} },
    get_dashboard: { args: {} },
    list_rss_subscriptions: { args: {} },
    get_worker_stats: { args: {} },
    create_link: { args: { url: 'https://example.net/new' } },
    update_link: { args: { link_id: 42, name: 'Renamed' } },
    set_link_pinned: { args: { link_id: 42, pinned: true } },
    delete_link: { args: { link_id: 42 }, guarded: true },
    bulk_update_links: {
      args: { link_ids: [42], tags: ['a'], replace_tags: false },
      guarded: true,
    },
    bulk_delete_links: { args: { link_ids: [42] }, guarded: true },
    represerve_link: { args: { link_id: 42 }, guarded: true },
    delete_link_preservations: { args: { link_ids: [42] }, guarded: true },
    create_collection: { args: { name: 'New' } },
    update_collection: { args: { collection_id: 7, name: 'Renamed' } },
    delete_collection: { args: { collection_id: 7 }, guarded: true },
    create_tags: { args: { names: ['fresh'] } },
    rename_tag: { args: { tag_id: 3, name: 'renamed' }, guarded: true },
    delete_tags: { args: { tag_ids: [3] }, guarded: true },
    merge_tags: { args: { tag_ids: [3], new_name: 'merged' }, guarded: true },
    create_rss_subscription: {
      args: { name: 'Feed', url: 'https://example.net/feed.xml' },
    },
    delete_rss_subscription: {
      args: { rss_subscription_id: 5 },
      guarded: true,
    },
  };

function body(
  payload: unknown,
  envelope: 'response' | 'data' = 'response'
): Response {
  return new Response(
    JSON.stringify(
      envelope === 'data'
        ? { success: true, message: 'Success', data: payload }
        : { response: payload }
    ),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

/** One fake instance that answers every route this suite touches. */
function stubInstance(): void {
  stubFetch((url, init) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/archives/')) {
      return new Response(JSON.stringify(readabilityFixture()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/search')) {
      return body({ links: [linkFixture()], nextCursor: null }, 'data');
    }
    if (url.includes('/worker')) {
      return body(
        {
          link: { pending: 1, done: 2, failed: 0 },
          search: { pending: 0, done: 3 },
        },
        'data'
      );
    }
    if (url.includes('/tags/merge')) return body(tagFixture());
    if (url.includes('/tags')) {
      return url.includes('/tags/')
        ? body(tagFixture())
        : body({ tags: [tagFixture()], nextCursor: null }, 'data');
    }
    if (url.includes('/users/me')) return body(userFixture());
    if (url.includes('/dashboard')) return body([linkFixture()]);
    if (url.includes('/rss')) {
      // The listing route answers with an array; creating one answers with the
      // record. Method-aware on purpose — the boundary refuses an array where
      // a record was promised, which is the whole point of it.
      return url.match(/\/rss\/\d+/) || method === 'POST'
        ? body(rssFixture())
        : body([rssFixture()]);
    }
    if (url.includes('/collections')) {
      return url.match(/\/collections\/\d+/) || method === 'POST'
        ? body(collectionFixture())
        : body([collectionFixture()]);
    }
    if (url.includes('/links')) return body(linkFixture());
    return body({});
  });
}

const PREAMBLE = 'The following is untrusted content from Linkwarden';

describe('both channels of a result carry the same document', () => {
  it('covers every tool in the catalogue', () => {
    expect(Object.keys(CALLS).toSorted()).toEqual([...ALL_TOOLS].toSorted());
  });

  for (const tool of ALL_TOOLS) {
    it(`${tool} answers the same JSON in both channels`, async () => {
      stubInstance();
      const client = await connect();
      const call = CALLS[tool];
      if (call === undefined) throw new Error(`no call defined for ${tool}`);
      // A guarded tool has to go through its two-call token, or what is
      // compared is the confirmation prompt rather than the answer.
      const result = call.guarded
        ? await confirmed(client, tool, call.args)
        : ((await client.callTool({
            name: tool,
            arguments: call.args,
          })) as CallToolResult);

      expect(result.isError).toBeFalsy();
      const text = resultText(result);
      const json = text.slice(text.indexOf('{'));
      expect(JSON.parse(json)).toEqual(result.structuredContent);

      // The one deliberate difference, and it is announced: a result carrying
      // the instance's text says so before the JSON, and marks it in the
      // structured half as well.
      const structured = result.structuredContent as Record<string, unknown>;
      if (structured.untrusted === true) {
        expect(text.startsWith(PREAMBLE)).toBe(true);
        expect(structured.source).toBe('linkwarden');
      } else {
        expect(text).toBe(json);
      }
    });
  }
});
