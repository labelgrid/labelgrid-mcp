/** Analytics toolset: one tool wrapping the streaming analytics summary. */

import { z } from 'zod';
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
  toolset: 'analytics',
  gate: 'read',
  title: 'Get streaming analytics',
  description:
    'Retrieve a streaming analytics summary for your catalog in a single call. `start_date` and `end_date` (both YYYY-MM-DD) are required and the window is capped at 30 days by the server. ' +
    'Optionally narrow the result by `platform` (SPOTIFY, ITUNES, APPLE_MUSIC), `release_id`, `isrc`, `upc`, or `artist_names`. ' +
    'By default all 15 metric sections are returned; pass `metrics` to request only a subset. Available metrics: ' +
    'streams, listeners, saves, skips, shares, completion-rate, lyrics-view-rate, canvas-view-rate, device-split, source-split, saves-by-tier, streams-by-country, streams-by-gender, streams-by-age, shares-by-country. ' +
    'This endpoint is rate-limited (about 60 requests per minute); a 429 response carries retry_after_seconds.',
  inputShape: {
    start_date: z.string().describe('Start of the reporting window, YYYY-MM-DD. Required.'),
    end_date: z
      .string()
      .describe('End of the reporting window, YYYY-MM-DD. Required. Max 30-day span.'),
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

export const analyticsTools: ToolDef[] = [getAnalytics];
