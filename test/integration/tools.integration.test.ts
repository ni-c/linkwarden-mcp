import {
  expectEveryToolExercised,
  startServer,
  toolCoverage,
  tokenOf,
  type LiveHarness,
} from 'mcp-integration-harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../src/tools/catalogue.js';
import { bootstrap, type Sandbox } from './bootstrap.js';

/**
 * Every tool in the catalogue, against a real Linkwarden in Docker.
 *
 * The stack is deliberately complete — Postgres **and** Meilisearch — because
 * without the search index Linkwarden falls back to a LIKE query and the
 * search *operators* stop working: a query using `name:` or `tag:` is matched
 * as one literal string, so a search that should return two links returns
 * none, with no error anywhere. A stub cannot show that; a half-built stack
 * would show the wrong thing.
 *
 * The page and the feed the suite bookmarks are served by a container on the
 * compose network, so nothing here reaches the public internet.
 */

let sandbox: Sandbox;
/** Declares elicitation, so guarded tools go through the real dialog. */
let asking: LiveHarness;
/** Declares none, so the same tools fall back to the two-call token. */
let plain: LiveHarness;

let collectionId: number;
let linkId: number;
let secondLinkId: number;
let tagIds: number[];

/** Reachable from the Linkwarden container only. */
const PAGE = 'http://site/index.html';
const FEED = 'http://site/atom.xml';

function parse<T>(text: string): T {
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error(`no JSON in result: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start)) as T;
}

beforeAll(async () => {
  sandbox = await bootstrap();
  asking = await startServer({ env: sandbox.env, elicit: 'accept' });
  plain = await startServer({ env: sandbox.env });
}, 900_000);

afterAll(async () => {
  await asking?.close();
  await plain?.close();
});

describe('the account', () => {
  it('reports who the token belongs to', async () => {
    const user = await asking.call('get_current_user');
    expect(user).toContain('integration');
  });

  it('answers the dashboard on an empty instance', async () => {
    // The empty case, which a fixture never covers: no links, no collections,
    // and the tool still has to produce something rather than fail.
    await asking.call('get_dashboard');
  });

  it('reports the archive worker queue', async () => {
    const stats = await asking.call('get_worker_stats');
    expect(stats).toMatch(/\d/);
  });
});

describe('collections', () => {
  it('creates one and reads it back', async () => {
    const created = parse<{ created: { id: number; name: string } }>(
      await asking.call('create_collection', {
        name: 'Integration Collection',
        description: 'Made by the integration suite.',
      })
    );
    collectionId = created.created.id;

    expect(await asking.call('list_collections')).toContain(
      'Integration Collection'
    );
    expect(
      await asking.call('get_collection', { collection_id: collectionId })
    ).toContain('Integration Collection');
  });

  it('renames it', async () => {
    await asking.call('update_collection', {
      collection_id: collectionId,
      name: 'Integration Collection Renamed',
    });
    expect(await asking.call('list_collections')).toContain(
      'Integration Collection Renamed'
    );
  });
});

describe('tags', () => {
  it('creates several at once', async () => {
    const created = parse<{ tags: { id: number; name: string }[] }>(
      await asking.call('create_tags', {
        names: ['integration-alpha', 'integration-beta', 'integration-gamma'],
      })
    );
    tagIds = created.tags.map((tag) => tag.id);
    expect(tagIds).toHaveLength(3);

    expect(await asking.call('list_tags')).toContain('integration-alpha');
    expect(await asking.call('get_tag', { tag_id: tagIds[0] })).toContain(
      'integration-alpha'
    );
  });

  it('renames one', async () => {
    await asking.call('rename_tag', {
      tag_id: tagIds[0],
      name: 'integration-renamed',
    });
    expect(await asking.call('list_tags')).toContain('integration-renamed');
  });
});

describe('links', () => {
  it('bookmarks a page on the compose network', async () => {
    const created = parse<{ created: { id: number } }>(
      await asking.call('create_link', {
        url: PAGE,
        name: 'Integration Link',
        description: 'Bookmarked by the integration suite.',
        collection_id: collectionId,
        tags: ['integration-renamed'],
      })
    );
    linkId = created.created.id;

    const one = await asking.call('get_link', { link_id: linkId });
    expect(one).toContain('Integration Link');
  });

  it('bookmarks a second one, for the bulk tools', async () => {
    secondLinkId = parse<{ created: { id: number } }>(
      await asking.call('create_link', {
        url: `${PAGE}?second`,
        name: 'Integration Link Two',
        collection_id: collectionId,
      })
    ).created.id;
  });

  it('edits one and pins it', async () => {
    await asking.call('update_link', {
      link_id: linkId,
      name: 'Integration Link Edited',
    });
    expect(await asking.call('get_link', { link_id: linkId })).toContain(
      'Integration Link Edited'
    );

    const pinned = parse<{ pinned: boolean }>(
      await asking.call('set_link_pinned', { link_id: linkId, pinned: true })
    );
    expect(pinned.pinned).toBe(true);
    expect(
      parse<{ link: { pinned: boolean } }>(
        await asking.call('get_link', { link_id: linkId })
      ).link.pinned
    ).toBe(true);
    await asking.call('set_link_pinned', { link_id: linkId, pinned: false });
  });

  it('edits both at once', async () => {
    // `replace_tags` has no default and is not optional: with `true` the
    // given tags replace whatever each link had, so an empty list strips them
    // all. Making the caller say which is the point.
    await asking.call('bulk_update_links', {
      link_ids: [linkId, secondLinkId],
      collection_id: collectionId,
      tags: ['integration-beta'],
      replace_tags: true,
    });
    expect(await asking.call('get_link', { link_id: secondLinkId })).toContain(
      'integration-beta'
    );
  });
});

/**
 * Searches until the index catches up, or gives up saying so.
 *
 * Linkwarden indexes into Meilisearch from its **worker**, so a search issued
 * straight after a write is answered from an index that does not contain it
 * yet — and an empty result is not an error, so this reads as "the search is
 * broken" rather than "wait a moment". Everything that queries here has to
 * allow for it.
 */
async function searchEventually(
  query: string,
  expected: string
): Promise<string> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const found = await asking.call('search_links', { query });
    if (found.includes(expected)) return found;
    if (Date.now() >= deadline) {
      throw new Error(
        `search for ${JSON.stringify(query)} never returned ` +
          `${JSON.stringify(expected)} within 60s. Is Meilisearch up, and is ` +
          `MEILI_HOST set? Last answer: ${found.slice(0, 300)}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

describe('search, with a real index behind it', () => {
  it('finds a link by name, once the worker has indexed it', async () => {
    await searchEventually(
      'Integration Link Edited',
      'Integration Link Edited'
    );
  });

  it('honours the field operators, which need Meilisearch', async () => {
    // The reason the compose stack runs Meilisearch. Without it Linkwarden
    // matches the whole query as one literal string, so `tag:` finds nothing
    // — silently, because an empty result is not an error.
    //
    // `name:` is an **exact** title match, not a substring: `name:Integration`
    // against a link called "Integration Link Edited" correctly returns
    // nothing, which looks exactly like the operators not working at all.
    await searchEventually(
      'name:"Integration Link Edited"',
      'Integration Link Edited'
    );
    await searchEventually('tag:integration-beta', 'Integration Link');
    // Negation, which only the Meilisearch branch understands.
    await searchEventually('!tag:nothing-has-this', 'Integration Link');
  });
});

describe('RSS', () => {
  it('lists the subscriptions, of which there are none', async () => {
    const listed = parse<{ rssSubscriptions?: unknown[] }>(
      await asking.call('list_rss_subscriptions')
    );
    expect(listed.rssSubscriptions ?? []).toHaveLength(0);
  });

  it('refuses a feed URL pointing at the instance itself', async () => {
    // This server's own SSRF guard, against a real instance rather than a
    // stubbed fetch: a subscription is a URL handed to Linkwarden, which then
    // fetches it from inside the network the instance sits on.
    // Naming the reason rather than passing a bare `true`: `expectError: true`
    // is also satisfied by a schema rejection, so a renamed argument would keep
    // this green while the SSRF guard it is about is never reached.
    await asking.call(
      'create_rss_subscription',
      {
        name: 'Integration Loopback',
        url: 'http://127.0.0.1:3010/api/v1/users',
        collection_id: collectionId,
      },
      { expectError: /refusing to point Linkwarden at 127\.0\.0\.1/ }
    );
  });

  it('is refused a compose-network feed by Linkwarden itself', async () => {
    // And this is why `create_rss_subscription` cannot be exercised for real
    // here. Linkwarden 2.14 and later resolve the feed URL and refuse an
    // internal hostname — "URL resolves to a blocked internal hostname" — so
    // the fixture feed served next to it on the compose network is exactly
    // what it will not accept. A public feed would work and is precisely what
    // this suite must not depend on.
    await asking.call(
      'create_rss_subscription',
      {
        name: 'Integration Subscription',
        url: FEED,
        collection_id: collectionId,
      },
      { expectError: 'blocked internal hostname' }
    );
  });
});

describe('the fallback path for a client with no dialog', () => {
  it('merges tags only after the token comes back', async () => {
    const refusal = await plain.call('merge_tags', {
      tag_ids: [tagIds[1], tagIds[2]],
      new_name: 'integration-merged',
    });
    expect(refusal).toContain('confirm_token');
    expect(plain.prompts).toHaveLength(0);

    await plain.call('merge_tags', {
      tag_ids: [tagIds[1], tagIds[2]],
      new_name: 'integration-merged',
      confirm_token: tokenOf(refusal),
    });
    const tags = await plain.call('list_tags');
    expect(tags).toContain('integration-merged');
    // The sources are gone: that is what "merge" means here, and it is why
    // the tool asks first.
    expect(tags).not.toContain('integration-beta');
  });

  it('deletes the remaining tag, then the links, then the collection', async () => {
    const listed = parse<{ tags: { id: number; name: string }[] }>(
      await plain.call('list_tags')
    );
    const merged = listed.tags.find(
      (tag) => tag.name === 'integration-merged'
    )!;
    await plain.confirmed('delete_tags', { tag_ids: [merged.id] });

    await plain.confirmed('delete_link_preservations', {
      link_ids: [secondLinkId],
    });
    await plain.confirmed('bulk_delete_links', { link_ids: [secondLinkId] });
  });

  it('asked a person on one harness and nobody on the other', () => {
    expect(asking.prompts.length).toBeGreaterThan(0);
    expect(plain.prompts).toHaveLength(0);
  });
});

describe('cleaning up', () => {
  it('re-preserves, then deletes what is left', async () => {
    await asking.call('represerve_link', { link_id: linkId });
    await asking.call('delete_link', { link_id: linkId });
    await asking.call('delete_collection', { collection_id: collectionId });
  });
});

it('exercises every tool in the catalogue', () => {
  const called = new Set([...asking.called, ...plain.called]);
  const skipped = {
    delete_rss_subscription:
      'needs a subscription, and none can be created here: Linkwarden 2.14 ' +
      'and later resolve the feed URL and refuse an internal hostname, so the ' +
      'fixture feed served beside it on the compose network is exactly what ' +
      'it will not accept. Subscribing to a public feed would make every run ' +
      'depend on somebody else’s uptime. `create_rss_subscription` *is* ' +
      'exercised — both refusals are asserted, Linkwarden’s and this ' +
      'server’s own SSRF guard.',
    get_link_content:
      'needs a finished preservation, which means Linkwarden’s archive worker ' +
      'has driven a headless browser over the page. That takes minutes and is ' +
      'the worker’s behaviour rather than this server’s — the tool is one GET ' +
      'against a preserved copy. Verified by hand; see CONTRIBUTING.md.',
  };
  const report = toolCoverage({ called }, ALL_TOOLS, skipped);
  console.log(
    `linkwarden-mcp: ${report.called.length}/${ALL_TOOLS.length} tools against a real Linkwarden, ` +
      `${report.skipped.length} excused`
  );
  expectEveryToolExercised({ called }, ALL_TOOLS, skipped);
});
