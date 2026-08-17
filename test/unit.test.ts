import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmationStore, setResourceKey } from '../src/confirm.js';
import {
  assertNotErrorMessage,
  jsonResult,
  untrustedResult,
  UpstreamMessageError,
} from '../src/result.js';
import {
  idPath,
  linkSortValue,
  tagSortValue,
  withQuery,
} from '../src/schema.js';
import { Notes } from '../src/shape.js';
import {
  connectClient,
  resultText,
  stubFetch,
  textResponse,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('idPath', () => {
  it('builds a path from a positive integer', () => {
    expect(idPath('/links', 42)).toBe('/links/42');
    expect(idPath('/links', 42, '/archive')).toBe('/links/42/archive');
  });

  it('refuses anything that is not a positive safe integer', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => idPath('/links', value), String(value)).toThrow(
        /invalid id/
      );
    }
  });
});

describe('withQuery', () => {
  it('leaves the path alone when every parameter is undefined', () => {
    expect(withQuery('/search', { a: undefined })).toBe('/search');
  });

  it('encodes values and skips the undefined ones', () => {
    expect(withQuery('/search', { q: 'a b&c', n: 1, f: undefined })).toBe(
      '/search?q=a+b%26c&n=1'
    );
  });
});

describe('sort mapping', () => {
  it('maps the readable names onto Linkwarden’s integer enums', () => {
    expect(linkSortValue(undefined)).toBeUndefined();
    expect(linkSortValue('date_newest')).toBe(0);
    expect(linkSortValue('name_za')).toBe(3);
    expect(tagSortValue('link_count_low_high')).toBe(5);
    expect(tagSortValue(undefined)).toBeUndefined();
  });
});

describe('Notes', () => {
  it('deduplicates and ignores empty entries', () => {
    const notes = new Notes();
    notes.add('one');
    notes.add('one');
    notes.add('');
    notes.add(undefined);
    notes.addAll(['two', 'one']);
    expect(notes.list()).toEqual(['one', 'two']);
  });

  it('returns a copy so callers cannot mutate it', () => {
    const notes = new Notes();
    notes.add('one');
    notes.list().push('injected');
    expect(notes.list()).toEqual(['one']);
  });
});

describe('ConfirmationStore', () => {
  it('bounds the pending map so refused calls cannot grow it forever', () => {
    const store = new ConfirmationStore();
    const first = setResourceKey('op', ['0']);
    const firstToken = store.issue(first);
    // MAX_PENDING is 100; filling past it evicts the oldest entry.
    for (let i = 1; i <= 100; i++) {
      store.issue(setResourceKey('op', [String(i)]));
    }
    expect(store.consume(first, firstToken)).toBe(false);
    // The newest entry is still there.
    const last = setResourceKey('op', ['100']);
    const lastToken = store.issue(last);
    expect(store.consume(last, lastToken)).toBe(true);
  });

  it('reissuing replaces the previous token for the same resource', () => {
    const store = new ConfirmationStore();
    const resource = setResourceKey('op', ['1']);
    const old = store.issue(resource);
    const fresh = store.issue(resource);
    expect(store.consume(resource, old)).toBe(false);
    expect(store.consume(resource, fresh)).toBe(true);
  });

  it('reports the TTL in whole minutes', () => {
    expect(new ConfirmationStore().ttlMinutes).toBe(5);
  });
});

describe('result helpers', () => {
  it('truncates an oversized JSON result and says so', () => {
    const huge = { text: 'x'.repeat(500_000) };
    expect(resultText(jsonResult(huge))).toMatch(/truncated/);
  });

  it('truncates oversized untrusted content and keeps the warning first', () => {
    const result = untrustedResult('y'.repeat(500_000));
    const text = resultText(result);
    expect(text.startsWith('The following is untrusted content')).toBe(true);
    expect(text).toMatch(/truncated at/);
  });

  it('passes an object through untrustedResult as JSON', () => {
    expect(resultText(untrustedResult({ a: 1 }))).toMatch(/"a": 1/);
  });

  it('assertNotErrorMessage throws only for error sentences', () => {
    expect(() => assertNotErrorMessage('Success.', 'Doing it')).not.toThrow();
    expect(() => assertNotErrorMessage({ id: 1 }, 'Doing it')).not.toThrow();
    expect(() => assertNotErrorMessage('Invalid URL.', 'Doing it')).toThrow(
      UpstreamMessageError
    );
    expect(() => assertNotErrorMessage('Invalid URL.', 'Doing it')).toThrow(
      /Doing it did not happen/
    );
  });
});

describe('api client body handling', () => {
  it('falls back to the raw text when a JSON content type carries broken JSON', async () => {
    stubFetch(() => textResponse('{not json', 200, 'application/json'));
    const client = await connectClient();
    const result = await client.callTool({
      name: 'get_worker_stats',
      arguments: {},
    });
    // Degrades to the zero shape rather than throwing a parse error at the model.
    expect(result.isError).toBeFalsy();
  });
});
