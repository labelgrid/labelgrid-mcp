/**
 * Insights toolset: the streaming analytics summary and the consolidated
 * artificial-streaming query (early-warning flags, reported records, and the
 * fee breakdown). All read-only.
 */

import { z } from 'zod';
import type { ApiResult } from '../api/http.js';
import { applyProjection } from '../projection.js';
import type { ToolDef } from './types.js';

/** The 15 metric sections the summary endpoint can return. */
const METRICS = [
  'streams',
  'listeners',
  'saves',
  'skips',
  'shares',
  'completion-rate',
  'lyrics-view-rate',
  'canvas-view-rate',
  'device-split',
  'source-split',
  'saves-by-tier',
  'streams-by-country',
  'streams-by-gender',
  'streams-by-age',
  'shares-by-country',
] as const;

const getAnalytics: ToolDef = {
  name: 'get_analytics',
  toolset: 'insights',
  gate: 'read',
  title: 'Get streaming analytics',
  description:
    'Retrieve a streaming analytics summary for your catalog in a single call. `start_date` and `end_date` (both YYYY-MM-DD) are required and the window is capped at 30 days by the server. ' +
    'Optionally narrow the result by `platform` (SPOTIFY, ITUNES, APPLE_MUSIC), `release_id`, `isrc`, `upc`, or `artist_names`. ' +
    'By default all 15 metric sections are returned; pass `metrics` (see its enum) to request only a subset. ' +
    'Rate-limited (about 60 requests per minute); a 429 response carries retry_after_seconds.',
  inputShape: {
    start_date: z.string().describe('Start of the reporting window, YYYY-MM-DD.'),
    end_date: z.string().describe('End of the reporting window, YYYY-MM-DD (max 30-day span).'),
    metrics: z
      .array(z.enum(METRICS))
      .optional()
      .describe('Subset of metric sections to return; omit for all 15.'),
    platform: z.enum(['SPOTIFY', 'ITUNES', 'APPLE_MUSIC']).optional(),
    release_id: z.number().int().positive().optional(),
    isrc: z.string().optional(),
    upc: z.string().optional(),
    artist_names: z.array(z.string()).optional().describe('Filter to one or more artist names.'),
    limit: z.number().int().positive().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) =>
    client.get('/analytics/summary', {
      filter: {
        start_date: args.start_date,
        end_date: args.end_date,
        platform: args.platform,
        release_id: args.release_id,
        isrc: args.isrc,
        upc: args.upc,
        artist_names: args.artist_names,
      },
      metrics: args.metrics,
      limit: args.limit,
    }),
};

const queryArtificialStreaming: ToolDef = {
  name: 'query_artificial_streaming',
  toolset: 'insights',
  gate: 'read',
  title: 'Query artificial-streaming data',
  description:
    'Query artificial-streaming (streaming-integrity) data for your catalog. Pick ONE view with `view`: ' +
    '`flags` lists Stream Radar early-warning flags surfacing possible artificial-streaming activity so you can act early, paginated — `filters`: status, severity, dsp, isrc, release_id, detected_from/detected_to (YYYY-MM-DD). ' +
    '`flag_detail` retrieves one flag by `flag_id` (required). Stream Radar is an optional add-on; without it the API returns a 403, surfaced verbatim. ' +
    '`records` lists the artificial-streaming records reported for your catalog, cursor-paginated — the per-record detail behind any artificial-streaming fee; `filters`: dsp (spotify or apple), start_date/end_date, release_id, isrc. ' +
    '`fee_breakdown` retrieves the per-release breakdown of an artificial-streaming fee for one billing period — `period` (required) is YYYY-MM. ' +
    "response_format:'detailed' returns the verbatim API response.",
  inputShape: {
    view: z
      .enum(['flags', 'flag_detail', 'records', 'fee_breakdown'])
      .describe('Which artificial-streaming read.'),
    flag_id: z.number().int().positive().optional().describe('Required for view flag_detail.'),
    period: z.string().optional().describe('YYYY-MM. Required for view fee_breakdown.'),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Filter names → values, passed through verbatim.'),
    cursor: z.string().optional().describe('Pagination cursor (view records).'),
    page: z.number().int().positive().optional().describe('1-based page number (view flags).'),
    per_page: z.number().int().positive().optional().describe('Items per page.'),
    response_format: z
      .enum(['concise', 'detailed'])
      .optional()
      .describe(
        "'concise' (default) keeps only the high-signal fields (ids always kept); 'detailed' returns the verbatim API response.",
      ),
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const view = args.view as string;
    if (view === 'flag_detail' && args.flag_id === undefined) {
      return {
        error: {
          code: 'INVALID_SELECTOR',
          message: "view 'flag_detail' requires `flag_id` — the flag to retrieve.",
          status: 0,
        },
      };
    }
    if (view === 'fee_breakdown' && args.period === undefined) {
      return {
        error: {
          code: 'INVALID_SELECTOR',
          message: "view 'fee_breakdown' requires `period` — the billing month, YYYY-MM.",
          status: 0,
        },
      };
    }
    let result: ApiResult<unknown>;
    if (view === 'flags') {
      result = await client.get('/stream-radar/flags', {
        page: args.page,
        per_page: args.per_page,
        filter: args.filters,
      });
    } else if (view === 'flag_detail') {
      result = await client.get(`/stream-radar/flags/${args.flag_id}`);
    } else if (view === 'records') {
      // The records endpoint takes its filters as top-level query params.
      result = await client.get('/royalties/artificial-streams', {
        ...((args.filters as Record<string, unknown> | undefined) ?? {}),
        cursor: args.cursor,
        per_page: args.per_page,
      });
    } else {
      result = await client.get(
        `/artificial-streaming-fee/${encodeURIComponent(String(args.period))}`,
      );
    }
    return applyProjection(result, 'query_artificial_streaming', args.response_format);
  },
};

export const insightsTools: ToolDef[] = [getAnalytics, queryArtificialStreaming];
