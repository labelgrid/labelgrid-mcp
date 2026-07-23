/**
 * Shared command helpers: execute an ApiResult-returning call and print it
 * (throwing exit 1 on a structured error), and parse `--fields`/`--fields-file`
 * JSON bodies and repeatable `--filter k=v` flags. The authenticated raw GET
 * for statement file downloads lives on the core client (`getRaw`).
 */

import { readFileSync } from 'node:fs';
import type { ApiError, ApiResult } from '@labelgrid/core';
import type { Command } from 'commander';
import type { CommandContext } from './context.js';
import { apiFailure } from './errors.js';
import { printApiError, printData } from './output.js';

/** Awaits an API result; prints data (exit 0) or the error (throws exit 1). */
export async function runApi(
  ctx: CommandContext,
  call: Promise<ApiResult<unknown>>,
): Promise<unknown> {
  const result = await call;
  if ('error' in result) {
    printApiError(ctx.out, result.error);
    throw apiFailure();
  }
  printData(ctx.out, result.data);
  return result.data;
}

/** Prints a structured error and throws exit 1 (for locally-detected errors). */
export function failWith(ctx: CommandContext, error: ApiError): never {
  printApiError(ctx.out, error);
  throw apiFailure();
}

/**
 * Resolves the request body from --fields (inline JSON) or --fields-file (a
 * JSON file). Exactly one must be provided; parse problems are usage errors.
 */
export function parseFields(
  cmd: Command,
  fields: string | undefined,
  fieldsFile: string | undefined,
): Record<string, unknown> {
  if (fields !== undefined && fieldsFile !== undefined) {
    cmd.error('Pass either --fields or --fields-file, not both.');
  }
  let raw: string;
  if (fields !== undefined) {
    raw = fields;
  } else if (fieldsFile !== undefined) {
    try {
      raw = readFileSync(fieldsFile, 'utf8');
    } catch {
      return cmd.error(`Could not read --fields-file: ${fieldsFile}.`);
    }
  } else {
    return cmd.error('Missing required option: --fields <json> or --fields-file <path>.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return cmd.error('The fields payload is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return cmd.error('The fields payload must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/** Commander collector for a repeatable `--filter k=v` option. */
export function collectFilter(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Turns collected `k=v` strings into a filters object (usage error on a bad pair). */
export function parseFilters(
  cmd: Command,
  pairs: string[] | undefined,
): Record<string, string> | undefined {
  if (pairs === undefined || pairs.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      cmd.error(`Invalid --filter "${pair}" — expected key=value.`);
    }
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/** Parses a comma-separated list flag into an array (undefined passes through). */
export function commaList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}
