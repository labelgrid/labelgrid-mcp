/**
 * The CLI's exit-code contract:
 *   0 — success
 *   1 — an API or structured error (already printed by the time this throws)
 *   2 — usage error (bad flags/arguments; commander errors map here too)
 */

export class CliError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message = '') {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** Thrown after a structured API error has been printed. */
export function apiFailure(): CliError {
  return new CliError(1);
}

/** Thrown after a confirmation prompt was declined. */
export function aborted(): CliError {
  return new CliError(1);
}

/** The mask a redacted token value is replaced with in error output. */
const ERROR_MASK = '[redacted]';

/** Replaces every occurrence of a known token value in `text` with the mask. */
export function redactToken(text: string, token?: string): string {
  if (token === undefined || token.length === 0) return text;
  return text.split(token).join(ERROR_MASK);
}

/**
 * Sanitizes an UNEXPECTED (non-structured) error message for display:
 *   1. keeps only the first line (drops any trailing stderr / argv dump),
 *   2. reduces a child-process `Command failed: <exe> <argv…>` prefix to just
 *      `Command failed: <exe>` — the argv can carry a secret,
 *   3. redacts the resolved token value wherever it still appears.
 * Exit-code handling is unchanged; only the printed text is sanitized.
 */
export function scrubErrorMessage(raw: string, token?: string): string {
  const firstLine = raw.split('\n', 1)[0];
  const withoutArgv = firstLine.replace(/^(Command failed:\s*\S+).*$/, '$1');
  return redactToken(withoutArgv, token);
}
