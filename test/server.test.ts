import { afterEach, describe, expect, it, vi } from 'vitest';

import { READ_TOOLS, WRITE_TOOLS } from '../src/tools/catalogue.js';
import {
  connect,
  envelopeResponse,
  linkFixture,
  stubFetch,
  stubFetchRejecting,
} from './harness.js';

/**
 * The full tool surface is hard-coded in src/tools/catalogue.ts — the tool
 * filter needs those names before anything is registered, so that file is where
 * a tool appearing or disappearing has to be a deliberate edit, and these tests
 * are what keep it honest.
 */

/** Tools that must carry destructiveHint, because they lose data. */
/**
 * Tools that carry a confirmation, which is not the same list as the
 * destructive ones and should not be conflated with it. Publishing a
 * collection is confirmed and destroys nothing; `create_link` writes and is
 * not confirmed. The annotation describes what a call does, the confirmation
 * decides whether a person is asked first.
 */
const GUARDED_TOOLS = [
  'delete_link',
  'bulk_update_links',
  'bulk_delete_links',
  'represerve_link',
  'delete_link_preservations',
  'delete_collection',
  'delete_tags',
  'merge_tags',
  'rename_tag',
  'delete_rss_subscription',
  'update_link',
  'update_collection',
];

const DESTRUCTIVE_TOOLS = [
  'delete_link',
  'bulk_update_links',
  'bulk_delete_links',
  'represerve_link',
  'delete_link_preservations',
  'delete_collection',
  'delete_tags',
  'merge_tags',
  'delete_rss_subscription',
  // Added with the annotation sweep: all three replace something written with
  // no way back — update_link discards the preserved copies when the URL
  // changes, rename_tag replaces a name on every link that carries the tag.
  'update_link',
  'update_collection',
  'rename_tag',
];

/** Writes that add or mark, and take nothing away. */
const ADDITIVE_TOOLS = [
  'create_link',
  'create_collection',
  'create_tags',
  'create_rss_subscription',
  'set_link_pinned',
];

describe('tool surface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers exactly the expected tools', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it('registers only the read tools in read-only mode', async () => {
    const client = await connect({ readOnly: true });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS].sort());
    for (const write of WRITE_TOOLS) {
      expect(names).not.toContain(write);
    }
  });

  it('lists tools without credentials so registries can introspect it', async () => {
    const client = await connect({ url: undefined, token: undefined });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([...READ_TOOLS]));
  });

  it('marks every read tool readOnlyHint and every destructive tool destructiveHint', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    for (const name of READ_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations?.readOnlyHint, name).toBe(true);
    }
    for (const name of DESTRUCTIVE_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations?.destructiveHint, name).toBe(true);
      expect(tool?.annotations?.readOnlyHint, name).not.toBe(true);
    }
    for (const name of ADDITIVE_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations?.destructiveHint, name).toBe(false);
    }
  });

  it('declares an output schema on every tool', async () => {
    // The same argument as the annotations below, one field along. A tool that
    // says nothing about its result forces a client to parse prose to find out
    // what it got, and the SDK sends no `structuredContent` at all for a tool
    // that declared no schema — seven tools here answered with a sentence.
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      // An object root, not merely a schema. SEP-2106 allows an array or a
      // scalar, but a 2025-era client is served that same tool with the schema
      // rewritten to `{result: …}` — so it would answer in two shapes
      // depending on who asked.
      expect(tool.outputSchema?.type, tool.name).toBe('object');
    }
  });

  it('marks the results that carry saved-page content as untrusted', async () => {
    // Bookmark titles, descriptions and above all the preserved article text
    // are written by whoever controls the target site. A client that reads only
    // `structuredContent` must not get them unframed — the note this server
    // adds lives in `notes`, which a client can read but not check.
    const client = await connect();
    const { tools } = await client.listTools();
    const marked = tools
      .filter((tool) => {
        const properties = tool.outputSchema?.properties as
          Record<string, unknown> | undefined;
        return properties?.untrusted !== undefined;
      })
      .map((tool) => tool.name)
      .sort();
    // The read tools. Everything else reports an id this server was given and
    // a count it made, or a record it just wrote.
    expect(marked).toEqual([
      'get_collection',
      'get_current_user',
      'get_dashboard',
      'get_link',
      'get_link_content',
      'get_tag',
      'list_collections',
      'list_rss_subscriptions',
      'list_tags',
      'search_links',
    ]);
  });

  it('declares all four annotation hints on every tool', async () => {
    // Not a style rule. Two of the four default to a *stronger* claim than
    // silence suggests: the specification gives destructiveHint and
    // openWorldHint a default of true, so a tool that omits them announces
    // itself as destructive and open-world. Three tools here shipped
    // `annotations: {}`, which is that claim in its emptiest form.
    const client = await connect();
    const tools = (await client.listTools()).tools;
    const hints = [
      'readOnlyHint',
      'destructiveHint',
      'idempotentHint',
      'openWorldHint',
    ] as const;
    for (const tool of tools) {
      for (const hint of hints) {
        expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe(
          'boolean'
        );
      }
    }
  });

  it('calls exactly the URL-taking tools open-world', async () => {
    // The caller supplies the URL and Linkwarden fetches it, so the caller
    // picks the address — the same boundary the SSRF guard watches. Every
    // other tool talks to the one configured instance.
    //
    // Written as the whole set, and the set is the one `test/ssrf.test.ts`
    // derives from the schemas: the tools with a URL parameter and the
    // open-world tools have to be the same three. This assertion used to read
    // `tool.name === 'create_link'`, which pinned the bug — `update_link` and
    // `create_rss_subscription` take a URL too, and the second one is the
    // broader path to the same fetch, since Linkwarden pulls the feed and
    // archives a link per entry.
    const openWorld = new Set([
      'create_link',
      'update_link',
      'create_rss_subscription',
    ]);
    const client = await connect();
    const tools = (await client.listTools()).tools;
    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(
        openWorld.has(tool.name)
      );
    }
    // The set is not a hand-kept list: it is the tools whose schema declares a
    // URL, so adding one without its annotation fails here.
    const withUrl = tools
      .filter((tool) => 'url' in (tool.inputSchema.properties ?? {}))
      .map((tool) => tool.name)
      .sort();
    expect(withUrl).toEqual([...openWorld].sort());
  });

  it('gives every tool a description that names its own tool', async () => {
    const client = await connect();
    for (const tool of (await client.listTools()).tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect((tool.description ?? '').length, tool.name).toBeGreaterThan(60);
    }
  });

  it('offers confirm_token on every destructive tool', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    for (const name of GUARDED_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      // Optional all the way down: if the tool is missing entirely, this has to
      // fail on the assertion below rather than throw on the property access.
      const properties = (
        tool?.inputSchema as
          { properties?: Record<string, unknown> } | undefined
      )?.properties;
      expect(Object.keys(properties ?? {}), name).toContain('confirm_token');
    }
  });
});

describe('request shape', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the bearer token and targets /api/v1', async () => {
    const calls = stubFetch(() => envelopeResponse(linkFixture()));
    const client = await connect();
    await client.callTool({ name: 'get_link', arguments: { link_id: 42 } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://links.example.net/api/v1/links/42');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer eyTestToken');
  });

  it('never follows redirects and always sets a timeout', async () => {
    const calls = stubFetch(() => envelopeResponse(linkFixture()));
    const client = await connect();
    await client.callTool({ name: 'get_link', arguments: { link_id: 42 } });

    expect(calls[0]?.init?.redirect).toBe('error');
    expect(calls[0]?.init?.signal).toBeDefined();
  });

  it('refuses to call the API without credentials and explains what is missing', async () => {
    const calls = stubFetchRejecting();
    const client = await connect({ url: undefined, token: undefined });
    const result = await client.callTool({
      name: 'list_collections',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/LINKWARDEN_URL/);
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-numeric id without touching the API', async () => {
    const calls = stubFetchRejecting();
    const client = await connect();
    const result = await client.callTool({
      name: 'get_link',
      arguments: { link_id: '../../admin' },
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('strips unknown arguments instead of forwarding them', async () => {
    const calls = stubFetch(() => envelopeResponse([]));
    const client = await connect();
    await client.callTool({
      name: 'search_links',
      arguments: { query: 'test', evil: 'DROP TABLE links', limit: 99999 },
    });

    expect(calls[0]?.url).not.toMatch(/evil/);
    expect(calls[0]?.url).not.toMatch(/99999/);
  });

  it('does not leak the token into an error message', async () => {
    stubFetch(() => new Response('nope', { status: 401 }));
    const client = await connect();
    const result = await client.callTool({
      name: 'list_collections',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toMatch(/eyTestToken/);
    expect(JSON.stringify(result.content)).toMatch(/LINKWARDEN_TOKEN/);
  });
});
