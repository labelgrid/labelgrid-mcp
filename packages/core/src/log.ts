/**
 * stderr-only structured logging with secret redaction.
 *
 * stdout is reserved for the MCP protocol stream, so every log line goes to
 * stderr. Any structured metadata is passed through {@link redactSecrets}
 * first so tokens, passwords and signed URLs never reach the log.
 */

const SECRET_KEY = /token|password|secret|nonce|authorization|key/i;
const MASK = '***REDACTED***';

/**
 * Deep-clones a value, replacing the value of any object key whose name looks
 * like a secret with a fixed mask. Non-secret values, arrays and primitives are
 * preserved (arrays and nested objects are walked recursively).
 */
export function redactSecrets(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map((item) => redactSecrets(item));
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? MASK : redactSecrets(value);
    }
    return out;
  }
  return v;
}

export type LogLevel = 'info' | 'warn' | 'error';

/** Writes a single redacted log line to stderr (never stdout). */
export function log(level: LogLevel, msg: string, meta?: unknown): void {
  let line = `[${level}] ${msg}`;
  if (meta !== undefined) {
    line += ` ${JSON.stringify(redactSecrets(meta))}`;
  }
  process.stderr.write(`${line}\n`);
}
