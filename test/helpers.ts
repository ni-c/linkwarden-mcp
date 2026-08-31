import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { vi } from 'vitest';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

export const BASE_URL = 'https://links.example.net';

export const config: Config = {
  url: BASE_URL,
  token: 'eyTestToken',
  insecureTls: false,
  readOnly: false,
  allowTools: undefined,
  denyTools: undefined,
};

export interface FetchCall {
  url: string;
  init?: RequestInit | undefined;
}

/** Replaces global fetch and records every call made through it. */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(handler(String(url), init));
    })
  );
  return calls;
}

/** Fails the test if any request is made; for "must not touch the API" cases. */
export function stubFetchRejecting(): FetchCall[] {
  return stubFetch((url) => {
    throw new Error(`unexpected request to ${url}`);
  });
}

function json(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The `{ "response": ... }` envelope most Linkwarden routes use. */
export function envelopeResponse(payload: unknown, status = 200): Response {
  return json(JSON.stringify({ response: payload }), status);
}

/** The `{ success, message, data }` envelope /search, /tags and /worker use. */
export function dataResponse(payload: unknown, status = 200): Response {
  return json(
    JSON.stringify({ success: true, message: 'Success', data: payload }),
    status
  );
}

/** A body with no envelope at all, as served by /archives/{id}. */
export function bareJsonResponse(payload: unknown, status = 200): Response {
  return json(JSON.stringify(payload), status);
}

/**
 * 200 with an empty body — what a Next.js route answers when it has no branch
 * for the HTTP method that was used.
 */
export function emptyResponse(): Response {
  return new Response('', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export function textResponse(
  body: string,
  status = 200,
  contentType = 'text/plain'
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

export async function connectClient(
  overrides: Partial<Config> = {}
): Promise<Client> {
  const server = createServer({ ...config, ...overrides });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

export function resultText(result: unknown): string {
  const content = (result as CallToolResult).content;
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

export function resultJson(result: unknown): Record<string, unknown> {
  const text = resultText(result);
  // untrustedResult prefixes a warning paragraph before the JSON body.
  const start = text.indexOf('{');
  return JSON.parse(text.slice(start)) as Record<string, unknown>;
}

export function requestBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

/** Extracts the confirm_token out of a refusal message. */
export function confirmTokenFrom(result: unknown): string {
  const match = /confirm_token="([0-9a-f]+)"/.exec(resultText(result));
  if (match?.[1] === undefined) {
    throw new Error(`no confirm token in: ${resultText(result)}`);
  }
  return match[1];
}

/* ------------------------------------------------------------------ fixtures */

export function collectionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Reading list',
    description: 'Stuff to read',
    color: '#0ea5e9',
    icon: null,
    iconWeight: null,
    parentId: null,
    isPublic: false,
    ownerId: 1,
    members: [
      { userId: 2, canCreate: true, canUpdate: false, canDelete: false },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    _count: { links: 12 },
    ...overrides,
  };
}

export function tagFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: 'reference',
    ownerId: 1,
    archiveAsScreenshot: null,
    archiveAsMonolith: null,
    archiveAsPDF: null,
    archiveAsReadable: true,
    archiveAsWaybackMachine: null,
    aiTag: null,
    aiGenerated: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    _count: { links: 5 },
    ...overrides,
  };
}

export function linkFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: 'An article',
    type: 'url',
    url: 'https://example.net/article',
    description: 'Why it matters',
    icon: null,
    iconWeight: null,
    color: null,
    collectionId: 7,
    collection: collectionFixture(),
    tags: [tagFixture()],
    pinnedBy: [],
    image: 'archives/7/42.png',
    pdf: 'unavailable',
    readable: 'archives/7/42_readability.json',
    monolith: null,
    aiTagged: false,
    lastPreserved: '2026-01-03T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

export function rssFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    name: 'Example feed',
    url: 'https://example.net/feed.xml',
    collectionId: 7,
    collection: { name: 'Reading list' },
    lastBuildDate: '2026-01-04T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    isPrivate: false,
    archiveAsScreenshot: true,
    archiveAsMonolith: false,
    archiveAsPDF: false,
    archiveAsReadable: true,
    archiveAsWaybackMachine: false,
    aiTaggingMethod: 'DISABLED',
    aiPredefinedTags: [],
    preventDuplicateLinks: true,
    hasUnIndexedLinks: false,
    ...overrides,
  };
}

/** The Mozilla Readability payload Linkwarden stores as the readable archive. */
export function readabilityFixture(overrides: Record<string, unknown> = {}) {
  return {
    title: 'An article',
    byline: 'A. Author',
    dir: null,
    lang: 'en',
    content: '<article>raw sanitized HTML that must not be returned</article>',
    textContent: 'The quick brown fox. '.repeat(50),
    length: 1000,
    excerpt: 'A short summary.',
    siteName: 'example.net',
    publishedTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
