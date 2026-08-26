import { internalHostKind } from './hosts.js';

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
 * Reads the configuration from environment variables.
 *
 * Missing credentials are only a warning, not a fatal error: the server must be
 * able to complete the MCP handshake and answer `tools/list` without them, so
 * registries and sandbox inspectors can introspect it. A malformed URL still
 * exits — that one could send the token to the wrong host.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.LINKWARDEN_URL;
  const token = env.LINKWARDEN_TOKEN;
  const insecureTls = env.LINKWARDEN_INSECURE_TLS === 'true';
  const readOnly = env.LINKWARDEN_READ_ONLY === 'true';
  const allowTools = env.LINKWARDEN_ALLOW_TOOLS;
  const denyTools = env.LINKWARDEN_DENY_TOOLS;

  // Don't keep the token in the environment for the process lifetime — it is
  // visible to child processes and in /proc/<pid>/environ. This happens before any
  // branch on purpose: the paths below either exit or return early, and "the URL
  // is missing or malformed" is exactly the state in which someone runs an
  // inspector or trips a crash reporter, so it is the last moment the token should
  // still be sitting in the environment.
  delete env.LINKWARDEN_TOKEN;

  const missing = [
    !url && 'LINKWARDEN_URL',
    !token && 'LINKWARDEN_TOKEN',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    console.error(`linkwarden-mcp: ${missingConfigMessage(missing)}`);
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
    console.error(
      `linkwarden-mcp: LINKWARDEN_URL must use http:// or https:// (got ${parsed.protocol})`
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

  // Tolerate a URL that already carries the API prefix: `redirect: 'error'` would
  // otherwise turn the resulting 308 into an opaque failure.
  const normalized = url.replace(/\/+$/, '').replace(/\/api\/v1$/, '');

  return {
    url: normalized,
    token,
    insecureTls,
    readOnly,
    allowTools,
    denyTools,
  };
}

function isLoopbackHost(hostname: string): boolean {
  // The same classifier the SSRF guard uses, so a loopback URL written as
  // http://[::1]:3000 or http://[::ffff:127.0.0.1]:3000 is recognised here too
  // and the plain-http warning does not fire on it.
  return internalHostKind(hostname) === 'loopback';
}
