/**
 * stderr-only structured logging with secret redaction.
 *
 * stdout is reserved for the MCP protocol stream, so every log line goes to
 * stderr. Any structured metadata is passed through {@link redactSecrets}
 * first so tokens, passwords and signed URLs never reach the log.
 */

const SECRET_KEY = /token|password|secret|nonce|authorization|key/i;
// A URL can carry an access token in its query (a signed upload URL, a private
// preview link, a webhook endpoint), so values under url/link keys are masked,
// and a URL inside any other logged string is replaced. A boolean or number
// under such a key (`links_page_enabled`) carries no URL and is kept. Any
// `scheme://` URL is matched (https, s3, ftp, …); letters glued in front of the
// scheme are removed with it. Scheme-less forms (`www.…`, `//host/…`) are not.
const URL_KEY = /url|link/i;
// Anchored on the literal `://`, so a match costs one pass over the string; an
// unanchored scheme run would rescan from every letter (polynomial backtracking).
const URL_BODY = /:\/\/[^\s"'<>]+/g;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/;
const MASK = '***REDACTED***';
const URL_MASK = '[url redacted]';

/** Replaces every `scheme://…` URL in `text`, scheme letters included. */
function scrubUrls(text: string): string {
  if (!text.includes('://')) return text;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL_BODY)) {
    const at = m.index ?? 0;
    let start = at;
    while (start > last && SCHEME_CHAR.test(text[start - 1] as string)) start--;
    // A bare `://` with no scheme in front of it is not a URL.
    if (start === at) continue;
    out += text.slice(last, start) + URL_MASK;
    last = at + m[0].length;
  }
  return out + text.slice(last);
}

/**
 * Deep-clones a value, replacing the value of any object key whose name looks
 * like a secret with a fixed mask, and every URL inside a string with a
 * placeholder. Other values are preserved (arrays and nested objects are walked
 * recursively).
 */
export function redactSecrets(v: unknown): unknown {
  if (typeof v === 'string') {
    return scrubUrls(v);
  }
  if (Array.isArray(v)) {
    return v.map((item) => redactSecrets(item));
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
      const carriesUrl =
        URL_KEY.test(key) && typeof value !== 'boolean' && typeof value !== 'number';
      out[key] = SECRET_KEY.test(key) || carriesUrl ? MASK : redactSecrets(value);
    }
    return out;
  }
  return v;
}

export type LogLevel = 'info' | 'warn' | 'error';

/** Writes a single redacted log line to stderr (never stdout). */
export function log(level: LogLevel, msg: string, meta?: unknown): void {
  let line = `[${level}] ${redactSecrets(msg)}`;
  if (meta !== undefined) {
    line += ` ${JSON.stringify(redactSecrets(meta))}`;
  }
  process.stderr.write(`${line}\n`);
}
