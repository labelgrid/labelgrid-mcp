/**
 * Insights toolset: the streaming analytics summary, the availability-discovery
 * endpoint, the top-N rankings (leaderboards and placements), and the
 * consolidated artificial-streaming query (early-warning flags, reported
 * records, and the fee breakdown). All read-only.
 */

import type { ApiResult } from '@labelgrid/core';
import { z } from 'zod';
import { applyProjection } from '../projection.js';
import type { ToolDef } from './types.js';

/**
 * The 47 metric sections the summary endpoint can return. The server's canonical
 * order — the order it projects sections into the response — is the streaming
 * sections, then the per-track daily series, then the social and UGC family.
 * This list groups the social and UGC family last instead; only membership
 * matters here, since the enum validates which keys are legal, not their order.
 */
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
  'library-adds',
  'shazams',
  'playlist-adds',
  'source-split-detailed',
  'discovery-rate',
  'repeat-rate',
  'listener-plan-mix',
  'listeners-by-age',
  'listeners-by-gender',
  'listeners-by-region',
  'apple-streams-by-city',
  'apple-streams-by-storefront',
  'apple-discovery-cohorts',
  'avg-listen-time',
  'shuffle-rate',
  'promoted-rate',
  'device-breakdown',
  'os-split',
  'audio-format-split',
  'hour-of-day',
  'shazams-by-city',
  'shazams-by-state',
  'social-usage-over-time',
  'social-reach-over-time',
  'social-platform-mix',
  'social-top-tracks',
  'social-territory',
  'social-artist-reach',
  'social-artist-reach-daily',
  'soundcloud-engagement',
  'track-streams-daily',
  'track-listeners-daily',
] as const;

/**
 * The UGC platform values `filter[ugc_platform]` accepts. A separate axis from
 * `platform`: it narrows the social and UGC sections only, and its values never
 * appear in a streaming total or platform share.
 */
const UGC_PLATFORMS = [
  'snapchat',
  'instagram',
  'facebook',
  'soundcloud',
  'tiktok',
  'whatsapp',
  'threads',
  'messenger',
] as const;

/** The maximum number of section keys the server accepts per summary request. */
const MAX_METRICS_PER_REQUEST = 12;

/** The platform values `filter[platform]` accepts (APPLE_MUSIC aliases ITUNES). */
const PLATFORMS = [
  'SPOTIFY',
  'ITUNES',
  'APPLE_MUSIC',
  'DEEZER',
  'BOOMPLAY',
  'AWA',
  'AUDIOMACK',
  'AMAZON',
  'KUGOU',
  'KUWO',
  'QQMUSIC',
] as const;

const getAnalytics: ToolDef = {
  name: 'get_analytics',
  toolset: 'insights',
  gate: 'read',
  title: 'Get streaming and social analytics',
  description:
    'Streaming analytics summary. Window capped at 400 days; `metrics` takes 1-12 section keys per request (split larger selections; responses cached). ' +
    'KUGOU/KUWO/QQMUSIC report weekly: one point carries the whole week — never average per day. `meta` carries `platform_cadence`, `section_granularity`, `sections_as_of` and `sections_complete_through` (later dates still filling in). ' +
    'See get_analytics_availability for per-platform support. ' +
    'Sections aggregate over the resolved filter scope: a `upc` filter gives release totals, not per-track rows. For those use `track-*-daily` (needs a `release_id`, `isrc` or `upc` scope) or get_analytics_rankings. `track-listeners-daily` sums per-entry daily counts: not distinct people, not summable across dates. ' +
    '`social-*` / `soundcloud-engagement` cover social/UGC usage, not streaming: `platform` is a UGC platform, `ugc_platform` narrows them; use, view and play are distinct quantities never summed together or with streams. Selecting any adds `meta.social_availability` (which UGC platforms report each signal); the streaming matrix omits them. ' +
    'Rate-limited ~60/min; windows over 90 days draw a separate ~30/min budget — prefer short windows for polling. A 429 carries retry_after_seconds.',
  inputShape: {
    start_date: z.string().describe('Window start, YYYY-MM-DD.'),
    end_date: z.string().describe('Window end, YYYY-MM-DD.'),
    metrics: z.array(z.enum(METRICS)).min(1).max(MAX_METRICS_PER_REQUEST),
    platform: z.enum(PLATFORMS).optional(),
    ugc_platform: z.enum(UGC_PLATFORMS).optional().describe('Social/UGC sections only.'),
    release_id: z.number().int().positive().optional(),
    isrc: z.string().optional(),
    upc: z.string().optional(),
    artist_names: z.array(z.string()).optional(),
    limit: z.number().int().positive().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) =>
    client.get('/analytics/summary', {
      filter: {
        start_date: args.start_date,
        end_date: args.end_date,
        platform: args.platform,
        ugc_platform: args.ugc_platform,
        release_id: args.release_id,
        isrc: args.isrc,
        upc: args.upc,
        artist_names: args.artist_names,
      },
      metrics: args.metrics,
      limit: args.limit,
    }),
};

const getAnalyticsAvailability: ToolDef = {
  name: 'get_analytics_availability',
  toolset: 'insights',
  gate: 'read',
  title: 'Get analytics availability',
  description:
    'Static `availability` matrix (per section, per platform) plus `platform_cadence` (daily|weekly per platform). Account- and date-independent: fetch once, reuse. ' +
    'Read it before get_analytics so an unreported section is treated as unavailable, not an empty chart.',
  inputShape: {},
  annotations: { readOnlyHint: true },
  handler: (_args, { client }) => client.get('/analytics/availability'),
};

/** The two ranking reads, and the entity kinds a leaderboard can rank. */
const RANKING_VIEWS = ['leaderboards', 'placements'] as const;
const LEADERBOARD_TYPES = ['artists', 'tracks', 'albums', 'all'] as const;

/** Upper bound the ranking endpoints place on `limit`. */
const MAX_RANKING_LIMIT = 50;

const getAnalyticsRankings: ToolDef = {
  name: 'get_analytics_rankings',
  toolset: 'insights',
  gate: 'read',
  title: 'Get analytics rankings',
  description:
    'Top-N rankings for a window, ordered by summed streams — the per-entity breakdown of a scope: `type` tracks with a `upc`/`release_id` filter ranks the tracks on that release. Pick ONE `view`: ' +
    '`leaderboards` — your top artists, tracks or albums (`type` required; `all` returns all three in one call). ' +
    '`placements` — playlists and radio containers driving streams, summed across storefronts. ' +
    'Same scope filters as get_analytics; `limit` 1-50 (default 10). Under a `platform` filter, `availability: not_available_for_platform` means no ranking there and `data` is empty.',
  inputShape: {
    view: z.enum(RANKING_VIEWS),
    start_date: z.string().describe('Window start, YYYY-MM-DD.'),
    end_date: z.string().describe('Window end, YYYY-MM-DD.'),
    type: z.enum(LEADERBOARD_TYPES).optional(),
    platform: z.enum(PLATFORMS).optional(),
    ugc_platform: z.enum(UGC_PLATFORMS).optional(),
    release_id: z.number().int().positive().optional(),
    isrc: z.string().optional(),
    upc: z.string().optional(),
    artist_names: z.array(z.string()).optional(),
    label_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Narrow to one of your own labels; never widens scope.'),
    limit: z.number().int().positive().max(MAX_RANKING_LIMIT).optional(),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => {
    const leaderboards = args.view === 'leaderboards';
    if (leaderboards && args.type === undefined) {
      return Promise.resolve({
        error: {
          code: 'INVALID_SELECTOR',
          message:
            "view 'leaderboards' requires `type` — artists, tracks, albums, or all. `type` does not apply to view 'placements'.",
          status: 0,
        },
      });
    }
    return client.get(leaderboards ? '/analytics/leaderboards' : '/analytics/placements', {
      filter: {
        start_date: args.start_date,
        end_date: args.end_date,
        platform: args.platform,
        ugc_platform: args.ugc_platform,
        release_id: args.release_id,
        isrc: args.isrc,
        upc: args.upc,
        artist_names: args.artist_names,
        label_id: args.label_id,
      },
      // `type` is a leaderboards-only parameter — never sent to placements.
      type: leaderboards ? args.type : undefined,
      limit: args.limit,
    });
  },
};

const queryArtificialStreaming: ToolDef = {
  name: 'query_artificial_streaming',
  toolset: 'insights',
  gate: 'read',
  title: 'Query artificial-streaming data',
  description:
    'Artificial-streaming (streaming-integrity) reads. Pick ONE `view`: ' +
    '`flags` — Stream Radar early-warning flags, paginated (`filters`: status, severity, dsp, isrc, release_id, detected_from/detected_to). Stream Radar is an optional add-on; without it the API returns a 403, surfaced verbatim. ' +
    '`flag_detail` — one flag by `flag_id`. ' +
    '`records` — reported artificial-streaming records, cursor-paginated; the detail behind any artificial-streaming fee (`filters`: dsp, start_date/end_date, release_id, isrc). ' +
    '`fee_breakdown` — per-release fee breakdown for one `period` (YYYY-MM). ' +
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
      .describe("'concise' (default) or 'detailed'."),
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

export const insightsTools: ToolDef[] = [
  getAnalytics,
  getAnalyticsAvailability,
  getAnalyticsRankings,
  queryArtificialStreaming,
];
