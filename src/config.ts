import { internalHostKind } from 'mcp-internal-hosts';

import {
  describeValue,
  firstNonPrintable,
  quotedIfWordShaped,
} from './text.js';

export interface Config {
  /**
   * Base URL of the Linkwarden instance, e.g. `https://links.example.net`.
   * Without the `/api/v1` suffix — the client appends it.
   * May be undefined together with the token: the server still starts and lists
   * its tools, every API call then fails with {@link missingConfigMessage}.
   */
  url: string | undefined;
  token: string | undefined;
  insecureTls: boolean;
  readOnly: boolean;
  /**
   * Whether a client that *can* show a dialog is asked before a guarded tool
   * acts. `ELICITATION=false` turns the dialog off — the guard stays and falls
   * back to the two-call token, so there is no setting in which a guarded call
   * goes unannounced.
   */
  elicitation: boolean;

  /**
   * Raw value of `LINKWARDEN_ALLOW_TOOLS` — comma-separated tool names,
   * `list_*` prefixes, or `essential`. Kept unparsed on purpose: this file is a
   * mirror of the environment, and the names can only be checked against the
   * tool catalogue, which `buildToolFilter` does.
   */
  allowTools: string | undefined;
  /** Raw value of `LINKWARDEN_DENY_TOOLS`, same shape, subtracted from the above. */
  denyTools: string | undefined;
}

/** Shown when the configuration is incomplete — at startup and on every API call. */
export function missingConfigMessage(missing: string[]): string {
  return (
    `missing required environment variable(s): ${missing.join(', ')}\n` +
    'Required: LINKWARDEN_URL (e.g. https://links.example.net), LINKWARDEN_TOKEN\n' +
    'Create the token in Linkwarden under Settings → Access Tokens. It carries the ' +
    'full permissions of the account that created it — Linkwarden has no per-token scopes.\n' +
    'Optional: LINKWARDEN_READ_ONLY=true to expose only read tools, ' +
    'LINKWARDEN_INSECURE_TLS=true to accept self-signed certificates, ' +
    'LINKWARDEN_ALLOW_TOOLS / LINKWARDEN_DENY_TOOLS to narrow the tool list ' +
    '(comma-separated names, "list_*" prefixes, or "essential")'
  );
}

/** Names of the required environment variables that are unset in `config`. */
export function missingConfigKeys(config: Config): string[] {
  return [
    !config.url && 'LINKWARDEN_URL',
    !config.token && 'LINKWARDEN_TOKEN',
  ].filter((v): v is string => Boolean(v));
}

/**
 * Reads `ELICITATION` — deliberately unprefixed, and deliberately fatal on
 * anything it does not recognise.
 *
 * Unprefixed: environment variables are process-wide, so this is one switch for
 * every server in the same environment. That is also its risk, which is why a
 * server started with it off says so on its startup line.
 *
 * Fatal: this is the first variable of the family that defaults to *on*. The
 * others fail open on a typo, which is the safe direction for them. Here a typo
 * would leave the dialog running while the operator believes it is off — and an
 * operator who believes that has no way to find out.
 */
export function parseElicitation(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'true') return true;
  if (value === 'false') return false;
  // The value is quoted only when it is short and word-shaped — a typo is a
  // word. `ELICITATION` is unprefixed and sits in the same block as the token
  // in every compose file, and a message whose whole purpose is to show the
  // operator what they typed must not print what they pasted.
  console.error(
    `linkwarden-mcp: ELICITATION must be "true" or "false" — got ${quotedIfWordShaped(raw ?? '')}. ` +
      'Refusing to start rather than guess.'
  );
  process.exit(1);
}

/**
 * Reads the configuration from environment variables.
 *
 * Missing credentials are only a warning, not a fatal error: the server must be
 * able to complete the MCP handshake and answer `tools/list` without them, so
 * registries and sandbox inspectors can introspect it. A malformed URL still
 * exits — that one could send the token to the wrong host.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.LINKWARDEN_URL;
  // Trimmed before anything looks at it: `$(cat token)` leaves a newline, and
  // a trailing newline is a shape the HTTP layer would refuse.
  const token = env.LINKWARDEN_TOKEN?.trim();
  const insecureTls = env.LINKWARDEN_INSECURE_TLS === 'true';
  // Deliberately more forgiving than `LINKWARDEN_INSECURE_TLS` above, and the
  // asymmetry is the safety argument rather than an oversight: a misspelt value
  // here fails *towards* the restriction, so `LINKWARDEN_READ_ONLY=1` in a
  // compose file must not silently register the write tools. The insecure-TLS
  // switch fails the other way, so it keeps the exact-match rule.
  const readOnly = /^(1|true|yes)$/i.test(
    env.LINKWARDEN_READ_ONLY?.trim() ?? ''
  );
  const allowTools = env.LINKWARDEN_ALLOW_TOOLS;
  const denyTools = env.LINKWARDEN_DENY_TOOLS;

  // Don't keep the token in the environment for the process lifetime — it is
  // visible to child processes and in /proc/<pid>/environ. This happens before any
  // branch on purpose: the paths below either exit or return early, and "the URL
  // is missing or malformed" is exactly the state in which someone runs an
  // inspector or trips a crash reporter, so it is the last moment the token should
  // still be sitting in the environment.
  delete env.LINKWARDEN_TOKEN;

  // After the delete, deliberately: this one can exit the process, and an exit
  // above would leave the credential in the environment for whatever runs next.
  const elicitation = parseElicitation(env.ELICITATION);

  const missing = [
    !url && 'LINKWARDEN_URL',
    !token && 'LINKWARDEN_TOKEN',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    console.error(`linkwarden-mcp: ${missingConfigMessage(missing)}`);
  }

  // A token that carries a character HTTP does not allow in a header value —
  // a line break inside it, which is what a wrapped copy out of a browser looks
  // like — would reach `fetch`, and `fetch` quotes the whole value when it
  // refuses it. Refusing to start says the same thing without the value: the
  // variable, the length, and where the offending character sits.
  if (token !== undefined && token !== '') {
    const at = firstNonPrintable(token);
    if (at !== -1) {
      console.error(
        `linkwarden-mcp: LINKWARDEN_TOKEN contains a character that cannot be sent in an ` +
          `HTTP header, at position ${at} of ${token.length}. ` +
          'Re-copy the token from Settings → Access Tokens; it is one unbroken line.'
      );
      process.exit(1);
    }
  }

  // Linkwarden access tokens are NextAuth JWTs, so they always start with the
  // base64url of `{"`. A value that does not is usually a copied session cookie
  // or a password — worth saying before the first 401.
  if (token && !token.startsWith('ey')) {
    console.error(
      'linkwarden-mcp: WARNING: LINKWARDEN_TOKEN does not look like a Linkwarden ' +
        'access token (those are JWTs and start with "ey"). Create one under ' +
        'Settings → Access Tokens.'
    );
  }

  if (!url) {
    return {
      url: undefined,
      token,
      insecureTls,
      readOnly,
      elicitation,
      allowTools,
      denyTools,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The value itself is not echoed: this branch fires precisely when the
    // variable does not hold what was expected, and a token pasted into the wrong
    // environment variable would otherwise be printed verbatim into the MCP host's
    // log.
    console.error(
      'linkwarden-mcp: LINKWARDEN_URL is not a valid URL (e.g. https://links.example.net)'
    );
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // The scheme is not echoed: a 56-character hexadecimal key with a colon
    // after it *is* a valid URL whose protocol is the key, so this branch is
    // one of the two a pasted secret lands in.
    console.error(
      `linkwarden-mcp: LINKWARDEN_URL must use http:// or https:// — the value that was set uses a different scheme (${describeValue(url)})`
    );
    process.exit(1);
  }
  // Credentials embedded in the URL would end up in logs and error messages.
  if (parsed.username || parsed.password) {
    console.error(
      'linkwarden-mcp: LINKWARDEN_URL must not contain credentials — use LINKWARDEN_TOKEN'
    );
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    console.error(
      'linkwarden-mcp: WARNING: LINKWARDEN_URL uses plain http to a non-local host — ' +
        'the API token will be sent unencrypted. Use https:// instead.'
    );
  }

  // Stored as the parsed URL, never as the environment string. A query or a
  // fragment left on the value used to be glued in front of every path —
  // `https://links.example.net/?debug=1` became
  // `https://links.example.net/?debug=1/api/v1/links/1`, and every call failed
  // in a way that named nothing. And the trailing slashes are counted off
  // rather than matched with `/\/+$/`, which is quadratic when the run is not
  // at the end: 80 000 of them cost 2.2 seconds.
  const dropped = [
    parsed.search !== '' && 'a query string',
    parsed.hash !== '' && 'a fragment',
  ].filter((what): what is string => Boolean(what));
  if (dropped.length > 0) {
    console.error(
      `linkwarden-mcp: WARNING: LINKWARDEN_URL carries ${dropped.join(' and ')}, which ${
        dropped.length > 1 ? 'were' : 'was'
      } dropped — only the origin and path are used.`
    );
  }
  // Tolerate a URL that already carries the API prefix: `redirect: 'error'` would
  // otherwise turn the resulting 308 into an opaque failure.
  const normalized = stripApiPrefix(
    parsed.origin + trimTrailingSlashes(parsed.pathname)
  );

  return {
    url: normalized,
    token,
    insecureTls,
    readOnly,
    elicitation,
    allowTools,
    denyTools,
  };
}

/**
 * Trailing slashes, counted off with an index.
 *
 * `replace(/\/+$/, '')` is the obvious spelling and is quadratic: the pattern
 * is tried from every position of the run and consumes it each time whenever a
 * character follows the run somewhere. And `while (s.endsWith('/')) s =
 * s.slice(0, -1)` is the same cost in bytes, one copy per slash. One walk, one
 * slice.
 */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 0x2f) end--;
  return path.slice(0, end);
}

/** Drops a `/api/v1` the operator already put on the URL. */
function stripApiPrefix(url: string): string {
  return url.endsWith('/api/v1') ? url.slice(0, -'/api/v1'.length) : url;
}

function isLoopbackHost(hostname: string): boolean {
  // The same classifier the SSRF guard uses, so a loopback URL written as
  // http://[::1]:3000 or http://[::ffff:127.0.0.1]:3000 is recognised here too
  // and the plain-http warning does not fire on it.
  return internalHostKind(hostname) === 'loopback';
}
