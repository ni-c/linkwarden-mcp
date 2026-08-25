/**
 * Regression tests for the SSRF guard, end to end through the MCP server.
 *
 * Linkwarden fetches every URL these tools hand it, and `get_link_content` reads
 * the preserved page back — so a URL pointing at Linkwarden's own loopback or at
 * the link-local range is a read primitive assembled out of valid tool calls.
 * Before the guard existed, `httpUrl` checked only the scheme and every one of
 * these reached the API.
 *
 * `stubFetchRejecting` throws on any request, so a test that expects a refusal
 * fails loudly if anything reaches Linkwarden at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  confirmTokenFrom,
  connectClient,
  envelopeResponse,
  linkFixture,
  requestBody,
  resultText,
  stubFetch,
  stubFetchRejecting,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const INTERNAL = [
  'http://127.0.0.1:8080/admin',
  'http://localhost:3000/',
  'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
  'http://[::1]/',
  'http://0.0.0.0/',
  // Spellings that a string comparison lets through: URL rewrites an
  // IPv4-mapped literal into hex before any check sees it.
  'http://[::ffff:127.0.0.1]:8080/admin',
  'http://[::ffff:169.254.169.254]/latest/meta-data/',
  'http://[::127.0.0.1]/',
  // The root label makes the same name look different.
  'http://localhost./',
  // Names that resolve to the metadata service only on the instance itself.
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://instance-data/latest/meta-data/',
];

describe('create_link', () => {
  it.each(INTERNAL)('refuses %s without touching the API', async (url) => {
    stubFetchRejecting();
    const client = await connectClient();
    const result = await client.callTool({
      name: 'create_link',
      arguments: { url },
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/loopback and link-local|only http/);
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)'])(
    'refuses the scheme of %s',
    async (url) => {
      stubFetchRejecting();
      const client = await connectClient();
      const result = await client.callTool({
        name: 'create_link',
        arguments: { url },
      });
      expect(result.isError).toBe(true);
    }
  );

  it('still bookmarks a private LAN address, which self-hosted setups use', async () => {
    const calls = stubFetch(() => envelopeResponse(linkFixture()));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'create_link',
      arguments: { url: 'http://192.168.1.50/router' },
    });

    expect(result.isError).toBeFalsy();
    expect(requestBody(calls[0]!)).toMatchObject({
      url: 'http://192.168.1.50/router',
    });
  });

  it('sends the parsed URL, not the string a fetcher would read differently', async () => {
    // The host of this is ok.example.com to a URL parser and 127.0.0.1 to a
    // fetcher that splits at the @. Forwarding the input verbatim would mean
    // checking one host and having Linkwarden fetch the other.
    const calls = stubFetch(() => envelopeResponse(linkFixture()));
    const client = await connectClient();
    await client.callTool({
      name: 'create_link',
      arguments: { url: 'http://ok.example.com\\@127.0.0.1/feed' },
    });

    const sent = (requestBody(calls[0]!) as { url: string }).url;
    expect(new URL(sent).hostname).toBe('ok.example.com');
    expect(sent).not.toContain('ok.example.com\\@');
  });
});

describe('create_rss_subscription', () => {
  it.each(INTERNAL)('refuses %s without touching the API', async (url) => {
    stubFetchRejecting();
    const client = await connectClient();
    const result = await client.callTool({
      name: 'create_rss_subscription',
      arguments: { name: 'feed', url },
    });
    expect(result.isError).toBe(true);
    // The guard's own message, not the stub's "unexpected request": without
    // that assertion this test would pass even with no guard at all.
    expect(resultText(result)).toMatch(/loopback and link-local|only http/);
  });

  it('still subscribes to a routable feed', async () => {
    const calls = stubFetch(() => envelopeResponse({ id: 1, name: 'feed' }));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'create_rss_subscription',
      arguments: { name: 'feed', url: 'https://example.com/rss' },
    });

    expect(result.isError).toBeFalsy();
    expect(requestBody(calls[0]!)).toMatchObject({
      url: 'https://example.com/rss',
    });
  });
});

describe('update_link', () => {
  it('refuses an internal URL and issues no confirmation token for it', async () => {
    const calls = stubFetch(() =>
      envelopeResponse(linkFixture({ url: 'https://example.net/old' }))
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'update_link',
      arguments: { link_id: 42, url: 'http://169.254.169.254/latest/' },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).not.toMatch(/confirm_token/);
    // The link is read to build the merge body; nothing is written.
    expect(calls.every((call) => call.init?.method !== 'PUT')).toBe(true);
  });

  it('still changes the URL to a routable one', async () => {
    const calls = stubFetch(() =>
      envelopeResponse(linkFixture({ url: 'https://example.net/old' }))
    );
    const client = await connectClient();
    const first = await client.callTool({
      name: 'update_link',
      arguments: { link_id: 42, url: 'https://example.net/new' },
    });
    const second = await client.callTool({
      name: 'update_link',
      arguments: {
        link_id: 42,
        url: 'https://example.net/new',
        confirm_token: confirmTokenFrom(first),
      },
    });

    expect(second.isError).toBeFalsy();
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(requestBody(put!)).toMatchObject({ url: 'https://example.net/new' });
  });

  it.each([
    ['a trailing slash', 'https://example.net', 'https://example.net/'],
    ['case in the host', 'https://EXAMPLE.net/A', 'https://example.net/A'],
    ['the default port', 'https://example.net:443/a', 'https://example.net/a'],
  ])(
    'does not rewrite a stored URL that differs only by %s',
    async (_name, stored, sent) => {
      // Two things have to hold together here. Re-sending the stored URL must
      // not count as a change — that would ask for a confirmation and then
      // destroy every preserved copy for nothing. And the body must still carry
      // the *stored* spelling: Linkwarden compares the old and new URL with
      // exact string equality and deletes the archives whenever they differ, so
      // writing the normalised form back would destroy them silently, without
      // even the confirmation the change path asks for.
      const calls = stubFetch(() =>
        envelopeResponse(linkFixture({ url: stored }))
      );
      const client = await connectClient();
      const result = await client.callTool({
        name: 'update_link',
        arguments: { link_id: 42, url: sent, name: 'Renamed' },
      });

      expect(result.isError).toBeFalsy();
      expect(resultText(result)).not.toMatch(/confirm_token/);
      const put = calls.find((call) => call.init?.method === 'PUT');
      expect(put, 'the rename should still be written').toBeDefined();
      expect(requestBody(put!)).toMatchObject({ url: stored });
    }
  );
});
