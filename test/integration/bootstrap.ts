import { assertLoopback, waitForHttp } from 'mcp-integration-harness';

/**
 * Brings the throwaway Linkwarden from empty to usable, without a browser.
 *
 * Four steps, and only the first is an obvious one: register through the users
 * endpoint, fetch a CSRF token, sign in through NextAuth's credentials
 * callback, then mint an API token with the session cookie that produced.
 *
 * Linkwarden's API is NextAuth underneath, so the login is not a JSON endpoint
 * that returns a token — it is a form post to `/auth/callback/credentials`
 * that sets a cookie, and the token endpoint is 401 without it.
 */

export const USERNAME = 'integration';
export const PASSWORD = 'integration-not-a-secret';

export interface Sandbox {
  url: string;
  token: string;
  env: Record<string, string>;
}

export async function bootstrap(
  url = 'http://127.0.0.1:3010'
): Promise<Sandbox> {
  assertLoopback(url);
  await waitForHttp(`${url}/api/v1/auth/session`, {
    timeoutSeconds: 300,
    ready: (response) => response.ok,
  });

  const registered = await fetch(`${url}/api/v1/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Integration',
      username: USERNAME,
      email: 'integration@example.net',
      password: PASSWORD,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!registered.ok) {
    throw new Error(
      `Linkwarden refused the registration (HTTP ${registered.status}): ` +
        `${(await registered.text()).slice(0, 300)}. On a fresh instance this ` +
        'should work; if this one already has an account, run `docker compose ' +
        '-f test/integration/compose.yml down -v` and up again.'
    );
  }

  const cookies = new Map<string, string>();
  const remember = (response: Response): void => {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      // Kept as a map: Set-Cookie carries only what changed, and NextAuth sets
      // the CSRF cookie and the session cookie on different responses.
      if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };
  const cookieHeader = (): string =>
    [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

  const csrfResponse = await fetch(`${url}/api/v1/auth/csrf`, {
    signal: AbortSignal.timeout(30_000),
  });
  remember(csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const signIn = await fetch(`${url}/api/v1/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(),
    },
    body: new URLSearchParams({
      csrfToken,
      username: USERNAME,
      password: PASSWORD,
      redirect: 'false',
      json: 'true',
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  remember(signIn);

  const session = await fetch(`${url}/api/v1/auth/session`, {
    headers: { cookie: cookieHeader() },
    signal: AbortSignal.timeout(30_000),
  });
  const who = (await session.json()) as { user?: { id: number } };
  if (who.user === undefined) {
    throw new Error(
      'Linkwarden did not establish a session. The sign-in is a NextAuth ' +
        'credentials callback, not a JSON endpoint — it answers 200 either ' +
        'way and only the cookie tells them apart.'
    );
  }

  const minted = await fetch(`${url}/api/v1/tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader(),
    },
    body: JSON.stringify({ name: 'integration', expires: 0 }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await minted.json()) as { response?: { secretKey?: string } };
  const token = body.response?.secretKey;
  if (token === undefined) {
    throw new Error(
      `Linkwarden minted no API token (HTTP ${minted.status}): ` +
        `${JSON.stringify(body).slice(0, 300)}`
    );
  }

  return {
    url,
    token,
    env: {
      LINKWARDEN_URL: url,
      LINKWARDEN_TOKEN: token,
      // Defaults to true in this server; the suite exists to drive the writes.
      LINKWARDEN_READ_ONLY: 'false',
    },
  };
}
