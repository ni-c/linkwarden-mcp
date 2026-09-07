/**
 * Text that came from the instance, on its way into the model context.
 *
 * Every string a Linkwarden answer carries — a bookmark title, a description, a
 * tag name, an error sentence, and above all the preserved article text — was
 * written by whoever controls the saved page or by another user of the
 * instance. Two things are done to all of them here, in one place, so that no
 * field is the one the sweep missed:
 *
 * - **Control characters are removed.** C0 except tab, line feed and carriage
 *   return; C1; DEL. An escape sequence in a title is a way to draw on the
 *   terminal of whoever reads the tool result, and this server had no cleaner
 *   at all: an ESC and a BEL in a 500 body reached the result verbatim.
 *   Format characters (bidi marks, joiners) are kept — in prose they are
 *   content.
 * - **Lone surrogates are repaired.** A `slice` at a character budget can cut a
 *   surrogate pair in half, and the instance's own JSON may carry a lone
 *   `\ud83d` escape, which is legal JSON. `JSON.stringify` writes it back as an
 *   escape, so the wire is valid — and a Python client that encodes the text
 *   raises `UnicodeEncodeError: surrogates not allowed`. `toWellFormed()`
 *   replaces the half with U+FFFD.
 *
 * The character classes are built from code points at runtime rather than
 * spelled as escapes: the editing tools of this family turn a backslash-u
 * escape in a source line into the raw byte, and a raw ESC in a source file is
 * exactly what this module exists to keep out of a result.
 */

const CONTROL_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
];

function characterClass(
  ranges: readonly (readonly [number, number])[]
): string {
  return `[${ranges
    .map(
      ([from, to]) =>
        `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
    )
    .join('')}]`;
}

const HAS_CONTROL = new RegExp(characterClass(CONTROL_RANGES));
const CONTROL_GLOBAL = new RegExp(characterClass(CONTROL_RANGES), 'g');

/** Strips control characters and repairs lone surrogates; see the module note. */
export function cleanText(value: string): string {
  const stripped = HAS_CONTROL.test(value)
    ? value.replace(CONTROL_GLOBAL, '')
    : value;
  return stripped.isWellFormed() ? stripped : stripped.toWellFormed();
}

/**
 * A short, cleaned copy of a string the instance chose, for the places where it
 * is quoted into a sentence — a confirmation dialog's `details`, an error
 * naming what came back. Cut to `max` characters with a note, never silently.
 */
export function cleanShort(value: string, max = 80): string {
  const clean = cleanText(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).toWellFormed()}… (${clean.length - max} more characters omitted)`;
}

const MAX_UPSTREAM_TEXT = 2000;

/**
 * An upstream body, made safe for the model context and labelled as what it is.
 *
 * HTML-shaped bodies — a reverse proxy's error page, a WAF block page — are
 * dropped entirely; everything else is stripped of control characters, cut, and
 * prefixed so a model reads it as the instance's words rather than as this
 * server's. Error results are built from `error.message` and no result budget
 * measures them, so the cut here is the only ceiling they have.
 */
export function upstreamText(body: string, max = MAX_UPSTREAM_TEXT): string {
  const trimmed = cleanText(body).trim();
  if (trimmed === '') return '';
  // The check is deliberately loose — an XML declaration, a leading comment or
  // a doctype followed by a newline are all the same thing here.
  if (/^(<!doctype|<html[\s>]|<\?xml|<!--)/i.test(trimmed)) {
    return '(HTML error page omitted)';
  }
  const cut =
    trimmed.length > max
      ? `${trimmed.slice(0, max).toWellFormed()}… (truncated)`
      : trimmed;
  return `(untrusted text from the instance): ${cut}`;
}

/**
 * Removes credentials from a URL. The pattern stops at the *last* `@` before
 * the path — `[^/?#]*@` — so `https://a@b@host/` loses both, and a path or
 * query that happens to contain `@` is left alone.
 */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1***@');
}

const HEADER_VALUE = new RegExp(
  `^[${String.fromCodePoint(0x09)}${String.fromCodePoint(0x20)}-${String.fromCodePoint(0x7e)}]*$`
);

/**
 * Refuses a header value the HTTP layer would refuse — before the HTTP layer
 * gets to quote it.
 *
 * undici's and Node's own message is
 * `Headers.append: "<value>" is an invalid header value.`, carrying the whole
 * value, and for the `Authorization` header the value *is* the token. A token
 * pasted across two lines — which is what a wrapped copy out of a browser looks
 * like — reached `fetch`, and `run()`'s generic catch handed the message on as
 * this server's words. The message here names the header and nothing else.
 */
export function assertHeaderValue(name: string, value: string): void {
  if (!HEADER_VALUE.test(value)) {
    throw new Error(
      `linkwarden-mcp: the ${name} header value contains a character HTTP does not allow; check LINKWARDEN_TOKEN`
    );
  }
}

/**
 * Replaces every occurrence of a secret in a message. The last line of defence
 * for the generic error path: whatever a library chose to quote, the configured
 * token is not part of it.
 */
export function redactSecret(
  message: string,
  secret: string | undefined
): string {
  if (!secret || secret.length < 4) return message;
  return message.split(secret).join('[redacted]');
}

/**
 * Describes a configuration value without printing it. The variable that holds
 * the wrong thing is, more often than not, holding the token that was meant for
 * the line above it.
 */
export function describeValue(raw: string): string {
  return `a ${raw.length}-character value`;
}

/**
 * A configuration value quoted only when it is short and word-shaped, described
 * by its length otherwise. `ELICITATION` must be `true` or `false`, so the
 * message exists to show the operator their typo — and a typo is a word.
 */
export function quotedIfWordShaped(raw: string): string {
  return /^[A-Za-z0-9_-]{1,12}$/.test(raw) ? `"${raw}"` : describeValue(raw);
}

/** Position of the first character outside visible ASCII, or -1. */
export function firstNonPrintable(value: string): number {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) return index;
  }
  return -1;
}
