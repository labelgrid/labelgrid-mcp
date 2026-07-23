/**
 * Shared parsing for the configurable request/transfer timeouts, used by both
 * the MCP server (env vars) and the CLI (flags and env vars). A value must be a
 * positive integer number of milliseconds; anything else is rejected so the
 * caller can fall back to the client default and warn once.
 */

export type TimeoutParse = {
  /** The parsed positive-integer ms, or undefined when unset OR invalid. */
  value: number | undefined;
  /** True only when a value was supplied but was not a positive integer. */
  invalid: boolean;
};

/** Parses a timeout string into a positive-integer millisecond value. */
export function parseTimeoutMs(raw: string | undefined): TimeoutParse {
  if (raw === undefined || raw.trim() === '') return { value: undefined, invalid: false };
  const n = Number(raw.trim());
  if (Number.isInteger(n) && n > 0) return { value: n, invalid: false };
  return { value: undefined, invalid: true };
}
