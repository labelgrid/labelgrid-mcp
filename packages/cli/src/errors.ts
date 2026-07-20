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
