import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/client';

import { connect, resultText, stubFetch } from './harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Every read tool, against whatever the instance decides to answer.
 *
 * The example tests next door check the shapes somebody thought of. This one
 * drives the whole server — the client lists first, so the SDK's own check of
 * `structuredContent` against the declared `outputSchema` runs on every success
 * path — and asserts three sentences never appear:
 *
 * - `Output validation error`, the SDK refusing a result the schema forbids;
 * - `is not a function`, a projection calling `.map` on something that is not
 *   an array;
 * - `Cannot read properties`, a field read off `null`.
 *
 * The generator is deliberately two-sided: arbitrary JSON, *and* envelopes with
 * the right shape and random leaves, because a value only reaches the schema if
 * the answer around it is shaped enough to be projected at all.
 *
 * `SHAPE_RUNS` raises the count for one deep local pass; CI runs the small one.
 */
const RUNS = Number(process.env.SHAPE_RUNS ?? 40);

/** Values that are the wrong type for *some* field of a Linkwarden record. */
const leaf = fc.oneof(
  fc.constant(null),
  fc.constant(0),
  fc.constant(-0),
  fc.constant(1.5),
  fc.constant(Number.MIN_SAFE_INTEGER - 1),
  fc.constant(true),
  fc.constant('a text where a number belongs'),
  fc.constant('x'.repeat(30_000)),
  fc.constant([]),
  fc.constant({}),
  fc.constant({ toString: 'constructor' }),
  fc.constant(String.fromCharCode(0xd800)),
  fc.constant(String.fromCharCode(27)),
  fc.jsonValue({ maxDepth: 2 })
);

/** A record with the keys Linkwarden uses and values that may be anything. */
function recordOfKeys(keys: string[]): fc.Arbitrary<Record<string, unknown>> {
  return fc.record(
    Object.fromEntries(keys.map((key) => [key, leaf])) as Record<
      string,
      fc.Arbitrary<unknown>
    >,
    { requiredKeys: [] }
  );
}

const linkKeys = [
  'id',
  'name',
  'type',
  'url',
  'description',
  'collectionId',
  'collection',
  'tags',
  'pinnedBy',
  'image',
  'pdf',
  'readable',
  'monolith',
  'aiTagged',
  'lastPreserved',
  'createdAt',
  'updatedAt',
];
const collectionKeys = [
  'id',
  'name',
  'description',
  'color',
  'parentId',
  'isPublic',
  'ownerId',
  'members',
  '_count',
  'createdAt',
];
const tagKeys = [
  'id',
  'name',
  'archiveAsReadable',
  'aiGenerated',
  '_count',
  'createdAt',
];
const userKeys = [
  'id',
  'username',
  'name',
  'isPrivate',
  'preventDuplicateLinks',
  'aiTaggingMethod',
  'aiPredefinedTags',
  'hasUnIndexedLinks',
];

/**
 * `1e999` cannot be written as a JavaScript literal — it *is* `Infinity` — so
 * the sentinel is spliced into the serialised text, which is how it arrives
 * from an instance.
 */
const INFINITY_SENTINEL = '"__1e999__"';

function serialise(payload: unknown): string {
  return (
    JSON.stringify(payload)?.split(INFINITY_SENTINEL).join('1e999') ?? '{}'
  );
}

const CASES: {
  tool: string;
  args: Record<string, unknown>;
  body: fc.Arbitrary<unknown>;
}[] = [
  {
    tool: 'search_links',
    args: {},
    body: fc.oneof(
      fc.jsonValue({ maxDepth: 3 }),
      fc.record({
        response: fc.record({
          links: fc.oneof(
            fc.array(recordOfKeys(linkKeys), { maxLength: 3 }),
            leaf
          ),
          nextCursor: fc.oneof(leaf, fc.constant('__1e999__')),
        }),
      })
    ),
  },
  {
    tool: 'get_link',
    args: { link_id: 1 },
    body: fc.record({ response: recordOfKeys(linkKeys) }),
  },
  {
    tool: 'list_collections',
    args: {},
    body: fc.oneof(
      fc.jsonValue({ maxDepth: 3 }),
      fc.record({
        response: fc.array(recordOfKeys(collectionKeys), { maxLength: 3 }),
      })
    ),
  },
  {
    tool: 'get_collection',
    args: { collection_id: 1 },
    body: fc.record({ response: recordOfKeys(collectionKeys) }),
  },
  {
    tool: 'list_tags',
    args: {},
    body: fc.oneof(
      fc.jsonValue({ maxDepth: 3 }),
      fc.record({
        success: fc.constant(true),
        data: fc.record({
          tags: fc.oneof(
            fc.array(recordOfKeys(tagKeys), { maxLength: 3 }),
            leaf
          ),
          nextCursor: fc.oneof(leaf, fc.constant('__1e999__')),
        }),
      })
    ),
  },
  {
    tool: 'get_tag',
    args: { tag_id: 1 },
    body: fc.record({ response: recordOfKeys(tagKeys) }),
  },
  {
    tool: 'get_current_user',
    args: {},
    body: fc.record({ response: recordOfKeys(userKeys) }),
  },
  {
    tool: 'get_dashboard',
    args: {},
    body: fc.oneof(
      fc.jsonValue({ maxDepth: 3 }),
      fc.record({
        response: fc.array(recordOfKeys(linkKeys), { maxLength: 3 }),
      })
    ),
  },
  {
    tool: 'list_rss_subscriptions',
    args: {},
    body: fc.oneof(
      fc.jsonValue({ maxDepth: 3 }),
      fc.record({
        response: fc.array(
          recordOfKeys(['id', 'name', 'url', 'collectionId', 'collection']),
          { maxLength: 3 }
        ),
      })
    ),
  },
  {
    tool: 'get_worker_stats',
    args: {},
    body: fc.record({
      success: fc.constant(true),
      data: recordOfKeys(['link', 'search']),
    }),
  },
];

describe('no answer from the instance takes a read tool down', () => {
  for (const { tool, args, body } of CASES) {
    it(`${tool} survives whatever comes back`, async () => {
      await fc.assert(
        fc.asyncProperty(body, async (payload) => {
          stubFetch(
            () =>
              new Response(serialise(payload), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
          );
          const client = await connect();
          const result = (await client.callTool({
            name: tool,
            arguments: args,
          })) as CallToolResult;
          const text = resultText(result);
          expect(text).not.toMatch(/Output validation error/);
          expect(text).not.toMatch(/is not a function/);
          expect(text).not.toMatch(/Cannot read properties/);
          // Nothing the instance sent reaches the result as a control
          // character, whichever field it arrived in.
          expect(text).not.toMatch(
            new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}]`)
          );
          vi.unstubAllGlobals();
        }),
        { numRuns: RUNS }
      );
    });
  }
});
