import { afterEach, describe, expect, it, vi } from 'vitest';

import { unwrapEnvelope } from '../src/api.js';
import { looksLikeErrorMessage, preservedFormats } from '../src/shape.js';
import {
  connectClient,
  emptyResponse,
  envelopeResponse,
  linkFixture,
  resultText,
  stubFetch,
  tagFixture,
  textResponse,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unwrapEnvelope', () => {
  it('unwraps both envelopes and leaves a bare body alone', () => {
    expect(unwrapEnvelope({ response: { id: 1 } })).toEqual({ id: 1 });
    expect(
      unwrapEnvelope({ success: true, message: 'Success', data: { id: 2 } })
    ).toEqual({ id: 2 });
    expect(unwrapEnvelope({ title: 'no envelope' })).toEqual({
      title: 'no envelope',
    });
    expect(unwrapEnvelope([1, 2])).toEqual([1, 2]);
    expect(unwrapEnvelope(null)).toBeNull();
  });

  it('distinguishes a null payload from a missing key', () => {
    // getCollectionById answers `{"response": null}` for an invisible id, which
    // is a real answer and must not fall through to the raw body.
    expect(unwrapEnvelope({ response: null })).toBeNull();
    expect(unwrapEnvelope({ success: true, data: [] })).toEqual([]);
  });

  it('does not mistake a payload field called data for an envelope', () => {
    // Only `data` together with `success` is an envelope.
    expect(unwrapEnvelope({ data: 'payload field' })).toEqual({
      data: 'payload field',
    });
  });
});

describe('looksLikeErrorMessage', () => {
  it('recognises the sentences Linkwarden returns with HTTP 200', () => {
    for (const message of [
      'Invalid URL.',
      'Error: Required [url]',
      'Permission denied.',
      'Collection is not accessible.',
      'Link already exists',
      'Please choose a valid collection.',
      'You have reached the limit of 20 RSS subscriptions.',
      "Sorry, we couldn't process your file.",
      "You can't move a link to/from a collection you don't own.",
      'Target collection does not match the data.',
      'Some links failed to update',
      'This route is deprecated, please use the new /api/v1/search route instead',
    ]) {
      expect(looksLikeErrorMessage(message), message).toBe(true);
    }
  });

  it('lets the success sentences through', () => {
    for (const message of [
      'Success.',
      'Link is being archived.',
      'All links updated successfully',
      'RSS subscription deleted.',
    ]) {
      expect(looksLikeErrorMessage(message), message).toBe(false);
    }
  });

  it('ignores non-strings', () => {
    expect(looksLikeErrorMessage({ id: 1 })).toBe(false);
    expect(looksLikeErrorMessage(undefined)).toBe(false);
  });
});

describe('preservedFormats', () => {
  it('treats the "unavailable" marker and empty strings as absent', () => {
    expect(
      preservedFormats({
        image: 'archives/1/1.png',
        pdf: 'unavailable',
        readable: '',
        monolith: null,
      })
    ).toEqual({
      screenshot: true,
      pdf: false,
      readable: false,
      monolith: false,
    });
  });
});

describe('error handling', () => {
  it('treats an empty 200 body as a failure, not as a silent success', async () => {
    // A Next.js route without a branch for the method used falls through and
    // answers 200 with nothing at all.
    stubFetch(() => emptyResponse());
    const client = await connectClient();
    const result = await client.callTool({
      name: 'rename_tag',
      arguments: { tag_id: 3, name: 'refs' },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/empty body/);
  });

  it('drops an HTML error page instead of feeding it to the model', async () => {
    stubFetch(() =>
      textResponse(
        '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1>secret proxy detail</body></html>',
        502,
        'text/html'
      )
    );
    const client = await connectClient();
    const result = await client.callTool({
      name: 'list_collections',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toMatch(/HTML error page omitted/);
    expect(text).not.toMatch(/secret proxy detail/);
  });

  it('truncates a very long error body', async () => {
    stubFetch(() => textResponse('x'.repeat(5000), 500));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'list_collections',
      arguments: {},
    });

    expect(resultText(result)).toMatch(/truncated/);
    expect(resultText(result).length).toBeLessThan(3000);
  });

  it('adds the duplicate-link hint on HTTP 409', async () => {
    stubFetch(() => envelopeResponse('Link already exists', 409));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'create_link',
      arguments: { url: 'https://example.net/already-there' },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/prevent duplicate links/);
  });

  it('explains a 403 in terms of collection membership', async () => {
    stubFetch(() => envelopeResponse('Permission denied.', 403));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_collection',
      arguments: { collection_id: 7 },
    });

    expect(resultText(result)).toMatch(/collection members/);
  });

  it('reports a non-JSON success body as text rather than crashing', async () => {
    stubFetch(() => textResponse('plain text answer'));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_worker_stats',
      arguments: {},
    });
    // No throw, no unhandled rejection — the tool degrades to zeroes.
    expect(result.isError).toBeFalsy();
  });

  it('survives a link that comes back without a collection', async () => {
    // update_link cannot build a safe body without the collection owner.
    stubFetch(() => envelopeResponse(linkFixture({ collection: undefined })));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'update_link',
      arguments: { link_id: 42, name: 'New name' },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/without its collection/);
  });

  it('reports a missing link before trying to write to it', async () => {
    const calls = stubFetch(() => envelopeResponse(null));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'update_link',
      arguments: { link_id: 999, name: 'New name' },
    });

    expect(result.isError).toBe(true);
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
  });
});

describe('input bounds', () => {
  it('rejects an empty bulk id list', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'bulk_delete_links',
      arguments: { link_ids: [] },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a bulk id list beyond the cap', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'bulk_delete_links',
      arguments: { link_ids: Array.from({ length: 201 }, (_, i) => i + 1) },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a negative or zero id', async () => {
    const client = await connectClient();
    for (const id of [0, -1]) {
      const result = await client.callTool({
        name: 'get_link',
        arguments: { link_id: id },
      });
      expect(result.isError, String(id)).toBe(true);
    }
  });

  it('rejects an unknown sort name', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_links',
      arguments: { sort: 'whatever' },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a max_chars beyond the cap', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_link_content',
      arguments: { link_id: 42, max_chars: 1_000_000 },
    });
    expect(result.isError).toBe(true);
  });

  it('caps the number of tags per create_tags call', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'create_tags',
      arguments: { names: Array.from({ length: 51 }, (_, i) => `t${i}`) },
    });
    expect(result.isError).toBe(true);
  });
});

describe('insecure TLS', () => {
  it('does not use the stubbable global fetch when a dispatcher is active', async () => {
    // The scoped undici dispatcher replaces global fetch, which is exactly why
    // tests must not silently pass through the secure path.
    const calls = stubFetch(() => envelopeResponse([tagFixture()]));
    const client = await connectClient({ insecureTls: true });
    await client.callTool({ name: 'list_collections', arguments: {} });
    expect(calls).toHaveLength(0);
  });
});
