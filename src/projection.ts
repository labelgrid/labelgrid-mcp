/**
 * Concise-mode field projection.
 *
 * Tools marked [proj] accept `response_format: 'concise' | 'detailed'`
 * (default concise). Concise mode projects the API response down to a per-tool
 * allowlist of high-signal fields so large payloads stop swamping the client's
 * context window; `'detailed'` bypasses projection and returns the verbatim
 * API response.
 *
 * The walk keeps, on every object: any key in the per-tool allowlist, ALWAYS
 * `id` and any key ending `_id`, and any key whose value is an object/array
 * (containers are what the walk traverses — this is what keeps pagination
 * envelopes like `{ data: [...] }` intact while their leaves are filtered).
 * Kept values are recursed into. A `"_projection": "concise"` marker is
 * appended at the TOP level only (when the top level is an object).
 *
 * Pagination fidelity: a subtree keyed exactly `meta` or `links` (at ANY depth)
 * is preserved VERBATIM — every field, unfiltered — so page counts, totals and
 * next/prev links always survive. Top-level primitive cursor keys
 * (`next_cursor`, `prev_cursor`, `cursor`) are likewise preserved so
 * cursor-paginated responses stay pageable under concise mode.
 *
 * Projection is presentation-only — it never transforms values. The 400K
 * toToolResult cap stays as the backstop for anything projection cannot tame.
 */

import type { ApiResult } from './api/http.js';

/** The shared allowlist for catalog entity reads (search_catalog / get_catalog_item). */
const CATALOG_FIELDS: readonly string[] = [
  'title',
  'name',
  'artist_name',
  'full_name',
  'status',
  'review_status',
  'is_live',
  'barcode_number',
  'cat',
  'isrc',
  'release_date',
  'created_at',
  'updated_at',
  'email',
  'ipi',
  'pro',
];

/** Per-tool concise-mode field allowlists, keyed by tool name. */
export const CONCISE_ALLOWLISTS: Record<string, readonly string[]> = {
  search_catalog: CATALOG_FIELDS,
  get_catalog_item: CATALOG_FIELDS,
  get_release_review: [
    'code',
    'title',
    'severity',
    'status',
    'requires_feedback',
    'message',
    'created_at',
  ],
  get_delivery_queue: ['status', 'outlet', 'outlet_id', 'delivered_at', 'created_at', 'type'],
  query_artificial_streaming: [
    'dsp',
    'country',
    'quantity',
    'period',
    'date',
    'status',
    'severity',
    'isrc',
    'upc',
  ],
  query_financials: [
    'period',
    'status',
    'currency',
    'gross_usd',
    'net_usd',
    'amount',
    'total_due_usd',
    'invoice_number',
    'transaction_type',
    'scope',
    'date_paid',
    'created_at',
  ],
};

/** Subtrees whose entire contents are kept verbatim, at any depth. */
const VERBATIM_ENVELOPE_KEYS: ReadonlySet<string> = new Set(['meta', 'links']);
/** Primitive cursor keys preserved at the TOP level only. */
const TOP_LEVEL_CURSOR_KEYS: ReadonlySet<string> = new Set([
  'next_cursor',
  'prev_cursor',
  'cursor',
]);

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function projectValue(value: unknown, keep: ReadonlySet<string>, topLevel = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => projectValue(item, keep));
  }
  if (isContainer(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // Pagination envelopes: a `meta`/`links` subtree is kept verbatim, unfiltered.
      if (VERBATIM_ENVELOPE_KEYS.has(key)) {
        out[key] = item;
        continue;
      }
      // Top-level primitive cursor keys survive so pagination isn't lost.
      if (topLevel && TOP_LEVEL_CURSOR_KEYS.has(key) && !isContainer(item)) {
        out[key] = item;
        continue;
      }
      if (keep.has(key) || key === 'id' || key.endsWith('_id') || isContainer(item)) {
        out[key] = isContainer(item) ? projectValue(item, keep) : item;
      }
    }
    return out;
  }
  return value;
}

/**
 * Projects `value` down to the allowlisted fields (plus `id`/`*_id` and
 * container keys), appending the `_projection: 'concise'` marker at the top
 * level when the top level is an object.
 */
export function projectConcise(value: unknown, keep: readonly string[]): unknown {
  const keepSet = new Set(keep);
  const projected = projectValue(value, keepSet, true);
  if (isContainer(projected) && !Array.isArray(projected)) {
    return { ...projected, _projection: 'concise' };
  }
  return projected;
}

/**
 * Applies a [proj] tool's concise projection to a successful result. Errors
 * pass through untouched; `response_format: 'detailed'` bypasses projection
 * entirely (the verbatim API response); absent or `'concise'` projects.
 */
export function applyProjection(
  result: ApiResult<unknown>,
  toolName: string,
  responseFormat: unknown,
): ApiResult<unknown> {
  if (responseFormat === 'detailed') return result;
  if ('error' in result) return result;
  return { data: projectConcise(result.data, CONCISE_ALLOWLISTS[toolName] ?? []) };
}
