import { afterEach, describe, expect, it, vi } from 'vitest';

import { READ_TOOLS, WRITE_TOOLS } from '../src/tools/catalogue.js';
import {
  connectClient,
  envelopeResponse,
  linkFixture,
  stubFetch,
  stubFetchRejecting,
} from './helpers.js';

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
    const client = await connectClient();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it('registers only the read tools in read-only mode', async () => {
    const client = await connectClient({ readOnly: true });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS].sort());
    for (const write of WRITE_TOOLS) {
      expect(names).not.toContain(write);
    }
  });

  it('lists tools without credentials so registries can introspect it', async () => {
    const client = await connectClient({ url: undefined, token: undefined });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(READ_TOOLS));
  });

  it('marks every read tool readOnlyHint and every destructive tool destructiveHint', async () => {
    const client = await connectClient();
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

  it('declares all four annotation hints on every tool', async () => {
    // Not a style rule. Two of the four default to a *stronger* claim than
    // silence suggests: the specification gives destructiveHint and
    // openWorldHint a default of true, so a tool that omits them announces
    // itself as destructive and open-world. Three tools here shipped
    // `annotations: {}`, which is that claim in its emptiest form.
    const client = await connectClient();
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

  it('calls only create_link open-world', async () => {
    // The caller supplies the URL and Linkwarden fetches it, so the caller
    // picks the address — the same boundary the SSRF guard watches. Every
    // other tool talks to the one configured instance.
    const client = await connectClient();
    const tools = (await client.listTools()).tools;
    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(
        tool.name === 'create_link'
      );
    }
  });

  it('gives every tool a description that names its own tool', async () => {
    const client = await connectClient();
    for (const tool of (await client.listTools()).tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect((tool.description ?? '').length, tool.name).toBeGreaterThan(60);
    }
  });

  it('offers confirm_token on every destructive tool', async () => {
    const client = await connectClient();
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
    const client = await connectClient();
    await client.callTool({ name: 'get_link', arguments: { link_id: 42 } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://links.example.net/api/v1/links/42');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer eyTestToken');
  });

  it('never follows redirects and always sets a timeout', async () => {
    const calls = stubFetch(() => envelopeResponse(linkFixture()));
    const client = await connectClient();
    await client.callTool({ name: 'get_link', arguments: { link_id: 42 } });

    expect(calls[0]?.init?.redirect).toBe('error');
    expect(calls[0]?.init?.signal).toBeDefined();
  });

  it('refuses to call the API without credentials and explains what is missing', async () => {
    const calls = stubFetchRejecting();
    const client = await connectClient({ url: undefined, token: undefined });
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
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link',
      arguments: { link_id: '../../admin' },
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('strips unknown arguments instead of forwarding them', async () => {
    const calls = stubFetch(() => envelopeResponse([]));
    const client = await connectClient();
    await client.callTool({
      name: 'search_links',
      arguments: { query: 'test', evil: 'DROP TABLE links', limit: 99999 },
    });

    expect(calls[0]?.url).not.toMatch(/evil/);
    expect(calls[0]?.url).not.toMatch(/99999/);
  });

  it('does not leak the token into an error message', async () => {
    stubFetch(() => new Response('nope', { status: 401 }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'list_collections',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toMatch(/eyTestToken/);
    expect(JSON.stringify(result.content)).toMatch(/LINKWARDEN_TOKEN/);
  });
});
