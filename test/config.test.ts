import { describe, expect, it, vi } from 'vitest';

import { loadConfig, missingConfigKeys } from '../src/config.js';

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { ...values } as NodeJS.ProcessEnv;
}

const complete = {
  LINKWARDEN_URL: 'https://links.example.net',
  LINKWARDEN_TOKEN: 'secret',
};

describe('ELICITATION', () => {
  it('defaults to on, and to on for an empty value', () => {
    // The only variable of this family that defaults to *on*. An unset switch
    // has to mean "ask", or a deployment that never heard of it would quietly
    // stop asking.
    expect(loadConfig(env({ ...complete })).elicitation).toBe(true);
    expect(loadConfig(env({ ...complete, ELICITATION: '' })).elicitation).toBe(
      true
    );
  });

  it('is switched off by "false", in any casing or padding', () => {
    for (const raw of ['false', 'FALSE', ' False ']) {
      expect(
        loadConfig(env({ ...complete, ELICITATION: raw })).elicitation,
        raw
      ).toBe(false);
    }
  });

  it('refuses to start on anything else, naming both valid values', () => {
    // Deliberately fatal rather than falling back to the default: a typo would
    // leave the dialog running while the operator believes it is off, and
    // nothing else would ever tell them.
    for (const raw of ['1', 'off', 'no']) {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      expect(() => loadConfig(env({ ...complete, ELICITATION: raw }))).toThrow(
        'exit'
      );
      expect(exit).toHaveBeenCalledWith(1);
      const message = String(error.mock.calls[0]?.[0] ?? '');
      expect(message, raw).toContain('ELICITATION');
      expect(message, raw).toContain('"true"');
      expect(message, raw).toContain('"false"');
      vi.restoreAllMocks();
    }
  });

  it('has already wiped the credential by the time it can exit', () => {
    // parseElicitation sits *after* the delete on purpose. An exit above it
    // would leave the credential in the environment for whatever a crash
    // reporter or an inspector does next — which is exactly what that delete
    // exists to prevent, and its comment says so.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const e = env({ ...complete, ELICITATION: 'nonsense' });
    expect(() => loadConfig(e)).toThrow('exit');
    expect(e.LINKWARDEN_TOKEN).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('loadConfig', () => {
  it('starts without credentials so tools stay listable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig(env({}));
    expect(config.url).toBeUndefined();
    expect(missingConfigKeys(config)).toEqual([
      'LINKWARDEN_URL',
      'LINKWARDEN_TOKEN',
    ]);
    spy.mockRestore();
  });

  it('deletes the token from the environment after reading it', () => {
    const e = env({
      LINKWARDEN_URL: 'https://service.example.com',
      LINKWARDEN_TOKEN: 'secret',
    });
    const config = loadConfig(e);
    expect(config.token).toBe('secret');
    expect(e.LINKWARDEN_TOKEN).toBeUndefined();
  });

  it('deletes the token even when the URL is missing', () => {
    // The server keeps running in this state (tools stay listable), and it is the
    // state in which an inspector or a crash reporter is most likely to be pointed
    // at the process — so the token must already be out of the environment.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = env({ LINKWARDEN_TOKEN: 'eySecret' });
    const config = loadConfig(e);
    expect(config.token).toBe('eySecret');
    expect(e.LINKWARDEN_TOKEN).toBeUndefined();
    spy.mockRestore();
  });

  it('deletes the token before exiting on a malformed URL, and does not log it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const e = env({
      LINKWARDEN_URL: 'not a url',
      LINKWARDEN_TOKEN: 'eySecret',
    });

    expect(() => loadConfig(e)).toThrow('exit');
    expect(e.LINKWARDEN_TOKEN).toBeUndefined();
    // The rejected value is never echoed — a token pasted into the wrong variable
    // would otherwise be printed verbatim into the host's log.
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('eySecret');
    expect(logged).not.toContain('not a url');

    exit.mockRestore();
    spy.mockRestore();
  });

  it('strips trailing slashes from the base URL', () => {
    const config = loadConfig(
      env({
        LINKWARDEN_URL: 'https://service.example.com//',
        LINKWARDEN_TOKEN: 't',
      })
    );
    expect(config.url).toBe('https://service.example.com');
  });

  it('rejects a URL containing credentials', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(() =>
      loadConfig(
        env({
          LINKWARDEN_URL: 'https://user:pw@service.example.com',
          LINKWARDEN_TOKEN: 't',
        })
      )
    ).toThrow('exit');
    exit.mockRestore();
    spy.mockRestore();
  });

  it('warns about plain http to a remote host but keeps going', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig(
      env({
        LINKWARDEN_URL: 'http://service.example.com',
        LINKWARDEN_TOKEN: 't',
      })
    );
    expect(config.url).toBe('http://service.example.com');
    expect(spy.mock.calls.flat().join(' ')).toMatch(/unencrypted/);
    spy.mockRestore();
  });

  it('does not warn about plain http to a loopback host', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const host of ['localhost', '127.0.0.1', 'dev.localhost', '[::1]']) {
      loadConfig(
        env({ LINKWARDEN_URL: `http://${host}:3000`, LINKWARDEN_TOKEN: 't' })
      );
    }
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/unencrypted/);
    spy.mockRestore();
  });

  it('rejects a non-http scheme', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(() =>
      loadConfig(env({ LINKWARDEN_URL: 'ftp://host/', LINKWARDEN_TOKEN: 't' }))
    ).toThrow('exit');
    exit.mockRestore();
    spy.mockRestore();
  });

  it('exits on an unparsable URL', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(() =>
      loadConfig(env({ LINKWARDEN_URL: 'not a url', LINKWARDEN_TOKEN: 't' }))
    ).toThrow('exit');
    exit.mockRestore();
    spy.mockRestore();
  });

  it('tolerates a URL that already carries the /api/v1 prefix', () => {
    // The client appends /api/v1 itself, and `redirect: "error"` would turn the
    // resulting 308 into an opaque failure.
    const config = loadConfig(
      env({
        LINKWARDEN_URL: 'https://links.example.net/api/v1',
        LINKWARDEN_TOKEN: 't',
      })
    );
    expect(config.url).toBe('https://links.example.net');
  });

  it('warns when the token does not look like a Linkwarden JWT', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(
      env({
        LINKWARDEN_URL: 'https://links.example.net',
        LINKWARDEN_TOKEN: 'hunter2',
      })
    );
    expect(spy.mock.calls.flat().join(' ')).toMatch(/Access Tokens/);
    spy.mockRestore();
  });

  it('does not warn about a token that looks right', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(
      env({
        LINKWARDEN_URL: 'https://links.example.net',
        LINKWARDEN_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.x.y',
      })
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reads the two boolean flags in opposite directions', () => {
    const config = loadConfig(
      env({
        LINKWARDEN_URL: 'https://links.example.net',
        LINKWARDEN_TOKEN: 'ey.x',
        LINKWARDEN_READ_ONLY: 'true',
        LINKWARDEN_INSECURE_TLS: 'True',
      })
    );
    expect(config.readOnly).toBe(true);
    // Anything other than the exact string "true" is off, so a typo cannot
    // silently disable certificate validation.
    expect(config.insecureTls).toBe(false);
  });

  it.each(['true', 'TRUE', ' true ', '1', 'yes', 'Yes'])(
    'reads LINKWARDEN_READ_ONLY=%j as on',
    (value) => {
      // Read-only fails *towards* the restriction, so every spelling an
      // operator plausibly writes into a compose file has to close it.
      // `LINKWARDEN_READ_ONLY=1` silently registering the write tools is the
      // one outcome it must not have — the opposite of the rule above, and for
      // the same reason.
      const config = loadConfig(
        env({
          LINKWARDEN_URL: 'https://links.example.net',
          LINKWARDEN_TOKEN: 'ey.x',
          LINKWARDEN_READ_ONLY: value,
        })
      );
      expect(config.readOnly).toBe(true);
    }
  );

  it.each(['false', '', 'no', '0', 'off'])(
    'reads LINKWARDEN_READ_ONLY=%j as off',
    (value) => {
      const config = loadConfig(
        env({
          LINKWARDEN_URL: 'https://links.example.net',
          LINKWARDEN_TOKEN: 'ey.x',
          LINKWARDEN_READ_ONLY: value,
        })
      );
      expect(config.readOnly).toBe(false);
    }
  );

  it.each(['1', 'yes', 'TRUE', ' true '])(
    'leaves LINKWARDEN_INSECURE_TLS off for %j',
    (value) => {
      const config = loadConfig(
        env({
          LINKWARDEN_URL: 'https://links.example.net',
          LINKWARDEN_TOKEN: 'ey.x',
          LINKWARDEN_INSECURE_TLS: value,
        })
      );
      expect(config.insecureTls).toBe(false);
    }
  );

  it('names both missing variables when nothing is configured', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(env({}));
    const output = spy.mock.calls.flat().join(' ');
    expect(output).toMatch(/LINKWARDEN_URL/);
    expect(output).toMatch(/LINKWARDEN_TOKEN/);
    expect(output).toMatch(/Access Tokens/);
    spy.mockRestore();
  });
});
