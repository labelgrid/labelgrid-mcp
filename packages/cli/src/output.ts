/**
 * Output rendering: human-readable tables/key-value text by default, the raw
 * API response under `--json`. Errors print as one line `code: message` on
 * stderr (plus the error JSON on stdout under `--json`).
 *
 * EVERY byte that reaches stdout/stderr passes through {@link scrubSecrets},
 * so a resolved token value can never appear in output — even when an API
 * response or error message happens to echo it back.
 */

import type { ApiError } from '@labelgrid/core';

/** A minimal writable sink (process.stdout/stderr or a test buffer). */
export type Sink = { write(chunk: string): unknown };

export type Output = {
  json: boolean;
  stdout: Sink;
  stderr: Sink;
  /** Secret values (the resolved token) masked out of every write. */
  secrets: string[];
};

const MASK = '***REDACTED***';

/** Replaces every occurrence of every secret value with a fixed mask. */
export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join(MASK);
  }
  return out;
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (isScalar(v)) return String(v);
  return JSON.stringify(v);
}

/** Renders an array of rows as an aligned plain-text table. */
export function renderTable(rows: unknown[]): string {
  if (rows.length === 0) return '(no rows)';
  if (!rows.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
    return rows.map((r) => cell(r)).join('\n');
  }
  const records = rows as Record<string, unknown>[];
  const columns: string[] = [];
  for (const row of records) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  const widths = columns.map((col) =>
    Math.max(col.length, ...records.map((row) => cell(row[col]).length)),
  );
  const line = (values: string[]): string =>
    values
      .map((v, i) => v.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  const out = [line(columns), line(widths.map((w) => '-'.repeat(w)))];
  for (const row of records) {
    out.push(line(columns.map((col) => cell(row[col]))));
  }
  return out.join('\n');
}

/** Renders an object as `key: value` lines (nested values as compact JSON). */
export function renderKeyValues(record: Record<string, unknown>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return '(empty)';
  return entries.map(([key, value]) => `${key}: ${cell(value)}`).join('\n');
}

/** Human rendering for an arbitrary API payload. */
export function humanize(payload: unknown): string {
  if (Array.isArray(payload)) return renderTable(payload);
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      const parts = [renderTable(record.data)];
      const meta = record.meta;
      if (meta !== null && typeof meta === 'object') {
        const bits = Object.entries(meta as Record<string, unknown>)
          .filter(([, v]) => isScalar(v))
          .map(([k, v]) => `${k}=${cell(v)}`);
        if (bits.length > 0) parts.push(bits.join('  '));
      }
      return parts.join('\n');
    }
    return renderKeyValues(record);
  }
  return cell(payload);
}

/** Prints a successful payload (raw JSON under --json, human text otherwise). */
export function printData(out: Output, payload: unknown): void {
  const text = out.json ? JSON.stringify(payload, null, 2) : humanize(payload);
  out.stdout.write(`${scrubSecrets(text, out.secrets)}\n`);
}

/** Prints a plain informational line (never used for API payloads). */
export function printLine(out: Output, text: string): void {
  out.stdout.write(`${scrubSecrets(text, out.secrets)}\n`);
}

/** Prints a structured error: one line to stderr, JSON to stdout under --json. */
export function printApiError(out: Output, error: ApiError): void {
  out.stderr.write(`${scrubSecrets(`${error.code}: ${error.message}`, out.secrets)}\n`);
  if (out.json) {
    out.stdout.write(`${scrubSecrets(JSON.stringify({ error }, null, 2), out.secrets)}\n`);
  }
}
