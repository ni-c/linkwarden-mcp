import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { unwrapEnvelope } from '../src/api.js';
import { idPath, withQuery } from '../src/schema.js';
import { clamp, MAX_NAME_CHARS } from '../src/shape.js';

/**
 * Properties of the three places a value crosses into a request or out of a
 * response.
 *
 * `idPath` is, by a deliberate decision recorded in `api.ts`, the *only* way
 * anything reaches a URL path — there is no string segment sanitiser, because
 * an unused one would invite somebody to interpolate past it later. That makes
 * its refusal the whole of the path-injection defence, which is worth stating
 * over every number rather than the three someone tried.
 *
 * `unwrapEnvelope` has to tell three response shapes apart, and its comment
 * already names the trap: `{"response": null}` and `{"data": []}` are
 * legitimate payloads, so the check is `in` rather than truthiness.
 */

const RUNS = { numRuns: 500 };

describe('nothing but a positive integer reaches a path', () => {
  it('a valid id lands in the path exactly once, unescaped', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom('/links', '/tags', '/collections'),
        fc.constantFrom('', '/archive', '/content'),
        (id, prefix, suffix) => {
          expect(idPath(prefix, id, suffix)).toBe(`${prefix}/${id}${suffix}`);
        }
      ),
      RUNS
    );
  });

  /**
   * Everything else throws. Zero and the negatives are not ids; a fraction and
   * an unsafe integer would both reach the server as something other than what
   * the caller meant, since `String(1e21)` is `"1e+21"`.
   */
  it('anything that is not a positive safe integer is refused', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.double({ min: 0.1, max: 1000, noInteger: true }),
          fc.constantFrom(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            Number.MAX_SAFE_INTEGER + 2,
            1e21
          )
        ),
        (value) => {
          expect(() => idPath('/links', value)).toThrow('invalid id');
        }
      ),
      RUNS
    );
  });
});

describe('a query string escapes what it carries', () => {
  /**
   * A search term is written by the caller and may hold anything. What has to
   * hold is that it cannot end the query and start a new parameter.
   */
  it('a value cannot forge another parameter', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }),
        fc.string({ maxLength: 20 }),
        (value, extra) => {
          const path = withQuery('/search', { q: value });
          const parsed = new URLSearchParams(path.slice(path.indexOf('?') + 1));
          if (!path.includes('?')) return;
          expect(parsed.get('q')).toBe(value);
          expect(parsed.has(extra)).toBe(extra === 'q');
        }
      ),
      RUNS
    );
  });

  it('an undefined parameter is left out rather than sent empty', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
        (cursor) => {
          const path = withQuery('/links', { cursor, sort: 1 });
          expect(path.includes('cursor=')).toBe(cursor !== undefined);
        }
      ),
      RUNS
    );
  });

  it('a path with no defined parameters keeps no question mark', () => {
    expect(withQuery('/links', { a: undefined, b: undefined })).toBe('/links');
  });
});

describe('the envelope is unwrapped by shape, not by truthiness', () => {
  /**
   * The trap the comment names: an empty or null payload is a payload. A
   * truthiness test would fall through to returning the envelope itself, and
   * the caller would then be handed `{response: null}` where it expected null.
   */
  it('an empty or null payload is still a payload', () => {
    expect(unwrapEnvelope({ response: null })).toBeNull();
    expect(unwrapEnvelope({ data: [], success: true })).toEqual([]);
    fc.assert(
      fc.property(fc.jsonValue(), (payload) => {
        expect(unwrapEnvelope({ response: payload })).toEqual(payload);
        expect(unwrapEnvelope({ data: payload, success: true })).toEqual(
          payload
        );
      }),
      RUNS
    );
  });

  /** A body with no envelope is handed back as it came — the archive route. */
  it('an unenveloped body is passed through unchanged', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.array(fc.jsonValue(), { maxLength: 5 }),
          fc.string(),
          fc.integer(),
          fc.constant(null)
        ),
        (body) => {
          expect(unwrapEnvelope(body)).toEqual(body);
        }
      ),
      RUNS
    );
  });

  it('never throws, whatever came back', () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        expect(() => unwrapEnvelope(body)).not.toThrow();
      }),
      RUNS
    );
  });
});

describe('clamped text says that it was clamped', () => {
  it('bounds the content and names the follow-up call', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 2000 }),
        fc.integer({ min: 1, max: 400 }),
        (value, limit) => {
          const clamped = clamp(
            value,
            limit,
            'call get_tag for the full record'
          );
          if (value.length <= limit) {
            expect(clamped).toBe(value);
          } else {
            expect(String(clamped).startsWith(value.slice(0, limit))).toBe(
              true
            );
            expect(clamped).toContain(`truncated at ${limit} characters`);
            expect(clamped).toContain('call get_tag');
          }
        }
      ),
      RUNS
    );
  });

  /**
   * `null` and `undefined` travel unchanged. Linkwarden distinguishes a field
   * that is absent from one that is empty, and turning either into a string
   * here would make a shaped record claim something the API did not say.
   */
  it('null and undefined are carried through untouched', () => {
    expect(clamp(null, MAX_NAME_CHARS, 'x')).toBeNull();
    expect(clamp(undefined, MAX_NAME_CHARS, 'x')).toBeUndefined();
  });
});
