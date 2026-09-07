import { describe, expect, it, vi, afterEach } from 'vitest';

import { loadConfig } from '../src/config.js';
import { looksLikeErrorMessage } from '../src/shape.js';
import { cleanText, upstreamText } from '../src/text.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * What an input can buy on the thread that serves every request.
 *
 * A regular expression with `$` after a repetition is tried from every position
 * of a run and consumes the run each time, which is quadratic — and the probe
 * that reads "held" is the one without a character *after* the run, because
 * then the pattern matches at the first position and never backtracks. So every
 * case here puts something behind the run.
 *
 * The numbers are generous on purpose: the point is the shape of the curve, not
 * a benchmark, and CI machines are slower than a workstation.
 */

function milliseconds(work: () => void): number {
  const started = process.hrtime.bigint();
  work();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

describe('operator input is linear', () => {
  it('normalises a URL with eighty thousand trailing slashes at once', () => {
    // `url.replace(/\/+$/, '')` cost 136/536/2196 ms at 20k/40k/80k with a
    // character behind the run. The counted walk is a single pass.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The run is not at the end — that is the case the old pattern paid for,
    // and the probe without a character behind the run reads as "held".
    const url = `https://links.example.net/${'/'.repeat(80_000)}api/v1`;
    const elapsed = milliseconds(() => {
      const config = loadConfig({
        LINKWARDEN_URL: url,
        LINKWARDEN_TOKEN: 'eyToken',
      } as NodeJS.ProcessEnv);
      expect(config.url?.endsWith('/api/v1')).toBe(false);
    });
    expect(elapsed).toBeLessThan(200);

    // And the plain trailing run, which is what an operator actually types.
    const trailing = milliseconds(() => {
      const config = loadConfig({
        LINKWARDEN_URL: `https://links.example.net/${'/'.repeat(80_000)}`,
        LINKWARDEN_TOKEN: 'eyToken',
      } as NodeJS.ProcessEnv);
      expect(config.url).toBe('https://links.example.net');
    });
    expect(trailing).toBeLessThan(200);
  });
});

describe('text from the instance is linear', () => {
  it.each([
    ['a run of the first alternative', 'invalid '.repeat(25_000)],
    ['a near-miss of the "not found" branch', `${'x'.repeat(100_000)} not fou`],
    ['a near-miss of "cannot be"', 'cannot b'.repeat(20_000)],
    ['a near-miss of "already exists"', 'already exist'.repeat(10_000)],
    ['a run of whitespace', `${' '.repeat(200_000)}x`],
  ])('screens %s at its ceiling', (_, body) => {
    // The 8 MB read cap is the real ceiling; 200 k is enough to show the curve
    // of a pattern that backtracks, and this one does not.
    expect(milliseconds(() => looksLikeErrorMessage(body))).toBeLessThan(200);
  });

  it('cleans and labels a body at the read ceiling', () => {
    const esc = String.fromCharCode(27);
    const body = `${esc}[31m`.repeat(200_000);
    expect(milliseconds(() => upstreamText(body))).toBeLessThan(200);
    expect(milliseconds(() => cleanText(body))).toBeLessThan(200);
  });
});
