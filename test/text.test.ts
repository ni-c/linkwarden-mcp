import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/client';

import { connect, resultText, stubFetch, textResponse } from './harness.js';
import { loadConfig } from '../src/config.js';
import {
  assertHeaderValue,
  cleanShort,
  cleanText,
  quotedIfWordShaped,
  redactSecret,
  upstreamText,
} from '../src/text.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Built at runtime: an editing tool writes a spelled escape as the raw byte. */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('text from the instance', () => {
  it('removes control characters and keeps the whitespace that is content', () => {
    expect(cleanText(`a${ESC}[31mb${BEL}`)).toBe('a[31mb');
    expect(cleanText('line\nnext\tcell\r\n')).toBe('line\nnext\tcell\r\n');
  });

  it('repairs a lone surrogate', () => {
    const lone = `head${String.fromCharCode(0xd800)}tail`;
    const clean = cleanText(lone);
    expect(clean.isWellFormed()).toBe(true);
    expect(clean).toContain('head');
  });

  it('labels an upstream body and cuts it', () => {
    expect(upstreamText('nope')).toBe(
      '(untrusted text from the instance): nope'
    );
    expect(upstreamText('x'.repeat(9000)).length).toBeLessThan(2100);
    expect(upstreamText('  <!DOCTYPE html><html>…')).toBe(
      '(HTML error page omitted)'
    );
    expect(upstreamText('   ')).toBe('');
  });

  it('cuts a quoted string and says how much it left out', () => {
    expect(cleanShort('a'.repeat(300), 80)).toMatch(
      /220 more characters omitted/
    );
  });

  it('refuses a header value the HTTP layer would refuse', () => {
    expect(() =>
      assertHeaderValue('Authorization', 'Bearer ey.ok')
    ).not.toThrow();
    expect(() =>
      assertHeaderValue('Authorization', 'Bearer ey\nSECRET')
    ).toThrow(/Authorization header value/);
    // And the message says nothing about the value itself.
    try {
      assertHeaderValue('Authorization', 'Bearer ey\nSECRETVALUE');
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRETVALUE');
    }
  });

  it('takes a secret out of a message a library wrote', () => {
    expect(redactSecret('quoting eyJSECRET here', 'eyJSECRET')).toBe(
      'quoting [redacted] here'
    );
    // Too short to be worth matching on, and matching would mangle the text.
    expect(redactSecret('abc', 'ab')).toBe('abc');
  });

  it('quotes only a word-shaped configuration value', () => {
    expect(quotedIfWordShaped('yes')).toBe('"yes"');
    expect(quotedIfWordShaped('eyJhbGciOiJIUzI1NiJ9.payload')).toBe(
      'a 28-character value'
    );
  });
});

describe('the token never reaches the model context', () => {
  it('refuses to start when the token carries a line break', () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    loadConfig({
      LINKWARDEN_URL: 'https://links.example.net',
      LINKWARDEN_TOKEN: 'eyJhbGciOi\nSECRETTAILVALUE',
    } as NodeJS.ProcessEnv);
    expect(exit).toHaveBeenCalledWith(1);
    const printed = errors.join('\n');
    expect(printed).toMatch(/position 10 of 26/);
    expect(printed).not.toContain('SECRETTAILVALUE');
  });

  it('trims the newline a shell substitution leaves behind', () => {
    const config = loadConfig({
      LINKWARDEN_URL: 'https://links.example.net',
      LINKWARDEN_TOKEN: 'eyJhbGciOi\n',
    } as NodeJS.ProcessEnv);
    expect(config.token).toBe('eyJhbGciOi');
  });

  it('does not send — and does not quote — a token fetch would refuse', async () => {
    const calls = stubFetch(() => textResponse('never reached'));
    const client = await connect({ token: 'eyJhbGciOi\nSECRETTAILVALUE' });
    const result = (await client.callTool({
      name: 'get_link',
      arguments: { link_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
    expect(resultText(result)).not.toContain('SECRETTAILVALUE');
    expect(resultText(result)).toMatch(/Authorization header value/);
  });

  it('takes the token out of an error the transport wrote', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new Error('connect ECONNREFUSED while sending Bearer eyTestToken')
        )
      )
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_link',
      arguments: { link_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(resultText(result)).not.toContain('eyTestToken');
    expect(resultText(result)).toContain('[redacted]');
  });
});

describe('what an error body may carry into the result', () => {
  it('strips control characters out of an error body', async () => {
    stubFetch(() => textResponse(`boom ${ESC}[31mRED${BEL}`, 500));
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_link',
      arguments: { link_id: 1 },
    })) as CallToolResult;
    const text = resultText(result);
    expect(text).not.toContain(ESC);
    expect(text).not.toContain(BEL);
    expect(text).toMatch(/untrusted text from the instance/);
  });

  it('cuts an unbounded 200-with-an-error-sentence body', async () => {
    // `PUT /links/{id}/archive` answers 200 with "Invalid URL." — and the
    // sentence is the instance's, up to the 8 MB read cap. An error result is
    // built from `error.message`, which no result budget measures.
    stubFetch(() =>
      textResponse(
        JSON.stringify({ response: `Invalid URL. ${'A'.repeat(500_000)}` }),
        200,
        'application/json'
      )
    );
    const client = await connect();
    const first = (await client.callTool({
      name: 'represerve_link',
      arguments: { link_id: 42 },
    })) as CallToolResult;
    // The first call is the confirmation prompt; the error is on the second.
    expect(resultText(first).length).toBeLessThan(4000);
  });

  it('answers a 401 with the status and the credential hint, however large the body', async () => {
    // The body used to be read under the 8 MB success ceiling *before* the
    // status was looked at, so a proxy's oversized login page answered with a
    // size complaint: no status, no hint, and a plain `Error` rather than a
    // `LinkwardenApiError`.
    stubFetch(() =>
      textResponse('x'.repeat(9 * 1024 * 1024), 401, 'text/html')
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_link',
      arguments: { link_id: 1 },
    })) as CallToolResult;
    const text = resultText(result);
    expect(text).toMatch(/HTTP 401/);
    expect(text).toMatch(/check LINKWARDEN_TOKEN/);
    expect(text).not.toMatch(/byte limit/);
    expect(text.length).toBeLessThan(4000);
  });

  it('still refuses an oversized body on the success path', async () => {
    stubFetch(() =>
      textResponse('x'.repeat(9 * 1024 * 1024), 200, 'application/json')
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_link',
      arguments: { link_id: 1 },
    })) as CallToolResult;
    expect(resultText(result)).toMatch(/byte limit/);
  });
});

describe('the configured URL', () => {
  it('keeps only the origin and the path, and says what it dropped', () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    const config = loadConfig({
      LINKWARDEN_URL: 'https://links.example.net/lw/?debug=1#frag',
      LINKWARDEN_TOKEN: 'eyToken',
    } as NodeJS.ProcessEnv);
    // Glued in front of every path before: `…/?debug=1/api/v1/links/1`.
    expect(config.url).toBe('https://links.example.net/lw');
    expect(errors.join('\n')).toMatch(/query string and a fragment/);
  });

  it('drops a trailing /api/v1 and every trailing slash', () => {
    const config = loadConfig({
      LINKWARDEN_URL: 'https://links.example.net/api/v1///',
      LINKWARDEN_TOKEN: 'eyToken',
    } as NodeJS.ProcessEnv);
    expect(config.url).toBe('https://links.example.net');
  });

  it('does not print a value that failed the scheme check', () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    // A hexadecimal key with a colon after it *is* a valid URL whose scheme is
    // the key — which is how a pasted secret reaches this branch.
    const key = 'a'.repeat(56);
    loadConfig({
      LINKWARDEN_URL: `${key}:x`,
      LINKWARDEN_TOKEN: 'eyToken',
    } as NodeJS.ProcessEnv);
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).not.toContain(key);
    expect(errors.join('\n')).toMatch(/58-character value/);
  });

  it('does not print a value that failed the ELICITATION check', () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    const pasted = 'eyJhbGciOiJIUzI1NiJ9.aVeryLongPastedSecret';
    loadConfig({
      LINKWARDEN_URL: 'https://links.example.net',
      LINKWARDEN_TOKEN: 'eyToken',
      ELICITATION: pasted,
    } as NodeJS.ProcessEnv);
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).not.toContain(pasted);
    // A typo is a word, and a word is quoted — that is what the message is for.
    const typo: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      typo.push(args.map(String).join(' '));
    });
    loadConfig({
      LINKWARDEN_URL: 'https://links.example.net',
      LINKWARDEN_TOKEN: 'eyToken',
      ELICITATION: 'ture',
    } as NodeJS.ProcessEnv);
    expect(typo.join('\n')).toContain('"ture"');
  });
});
