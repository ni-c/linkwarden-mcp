import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

import {
  missingConfigKeys,
  missingConfigMessage,
  type Config,
} from './config.js';

/**
 * 30 s rather than the usual 15 s: search goes through Meilisearch and the
 * dashboard aggregates several queries, both of which are noticeably slower than
 * a plain record lookup on a small self-hosted instance.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** Every route this server touches lives under this prefix. */
const API_PREFIX = '/api/v1';

export class LinkwardenApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string
  ) {
    super(`Linkwarden API ${method} ${path} failed with HTTP ${status}`);
    this.name = 'LinkwardenApiError';
  }
}

/** Raw response of a request that is not JSON-decoded, e.g. an archive file. */
export interface RawResponse {
  contentType: string;
  text: string;
}

/**
 * Minimal client for the Linkwarden REST API (verified against Linkwarden
 * v2.16.0).
 *
 * The one non-obvious part is {@link unwrapEnvelope}: Linkwarden answers in two
 * different envelopes depending on the route.
 */
export class LinkwardenApi {
  private readonly config: Config;
  private readonly baseUrl: string;
  /**
   * Only set when LINKWARDEN_INSECURE_TLS is enabled. Scopes the relaxed
   * certificate validation to requests against the configured host instead of
   * disabling it process-wide via NODE_TLS_REJECT_UNAUTHORIZED.
   */
  private readonly insecureDispatcher?: Agent;

  constructor(config: Config) {
    this.config = config;
    this.baseUrl = config.url ?? '';
    if (config.insecureTls) {
      this.insecureDispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }
  }

  private async send(
    method: string,
    path: string,
    body?: unknown
  ): Promise<RawResponse> {
    // The credentials are only required here, not at startup, so the server can
    // still be started and introspected without them.
    const missing = missingConfigKeys(this.config);
    if (missing.length > 0) {
      throw new Error(missingConfigMessage(missing));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token ?? ''}`,
      Accept: 'application/json',
    };
    const init: RequestInit = {
      method,
      headers,
      // Never follow a redirect: it would resend the Authorization header to
      // whatever host the upstream points at. This is not theoretical here —
      // Linkwarden is commonly put behind a reverse proxy that redirects
      // http -> https, and a mistyped LINKWARDEN_URL would leak the token.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const url = `${this.baseUrl}${API_PREFIX}${path}`;
    // The insecure dispatcher requires undici's own fetch; the default path uses
    // the (stubbable) global fetch so tests can intercept it.
    const response = this.insecureDispatcher
      ? await undiciFetch(url, {
          ...init,
          dispatcher: this.insecureDispatcher,
        } as UndiciRequestInit)
      : await fetch(url, init);
    const text = await response.text();

    if (!response.ok) {
      throw new LinkwardenApiError(response.status, text, method, path);
    }

    return { contentType: response.headers.get('content-type') ?? '', text };
  }

  /** Performs a request and returns the payload with the envelope removed. */
  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const { contentType, text } = await this.send(method, path, body);

    // A Next.js API route without a branch for the given method falls through
    // and answers 200 with an empty body. Treating that as success would report
    // a write that never happened.
    if (text.trim() === '') {
      throw new LinkwardenApiError(
        200,
        'The endpoint returned an empty body. Linkwarden does this when a route ' +
          'does not implement the HTTP method that was used.',
        method,
        path
      );
    }

    if (!contentType.includes('application/json')) {
      return text;
    }
    try {
      return unwrapEnvelope(JSON.parse(text));
    } catch {
      return text;
    }
  }

  /**
   * Fetches a path without JSON decoding. Used for archive files, which are
   * binary for the image and PDF formats and must not be turned into text.
   */
  getRaw(path: string): Promise<RawResponse> {
    return this.send('GET', path);
  }

  get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  put(path: string, body?: unknown): Promise<unknown> {
    return this.request('PUT', path, body);
  }

  delete(path: string, body?: unknown): Promise<unknown> {
    return this.request('DELETE', path, body);
  }
}

/**
 * Strips Linkwarden's response envelope.
 *
 * Most routes answer `{ "response": <payload> }`. The two newer ones —
 * `GET /search` and `GET /tags` — answer
 * `{ "success": true, "message": "Success", "data": <payload> }` instead.
 * `GET /archives/{id}` returns the stored file with no envelope at all.
 *
 * Checked with `in` rather than a truthiness test: `{"response": null}` and
 * `{"data": []}` are both legitimate payloads.
 */
export function unwrapEnvelope(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }
  const record = parsed as Record<string, unknown>;
  if ('data' in record && 'success' in record) return record.data;
  if ('response' in record) return record.response;
  return parsed;
}

// There is deliberately no string path-segment sanitiser here. Linkwarden
// addresses everything by numeric id, so `idPath` in schema.ts is the only way a
// value reaches a URL path, and it accepts nothing but a positive safe integer.
// An unused string sanitiser would only invite someone to interpolate a string
// past it later.
