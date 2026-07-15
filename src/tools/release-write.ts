/**
 * Release write toolset (safe writes): the release/track draft lifecycle plus
 * validate, quality-report refresh, landing-page config, a short URL, and
 * review-issue notes.
 *
 * create_release and create_track send an auto-generated Idempotency-Key so a
 * retried creation cannot duplicate the entity. Release/track create+update
 * forward a permissive `fields` object straight to the API, which owns all
 * validation; the descriptions name the required fields.
 */

import { z } from 'zod';
import type { ToolDef } from './types.js';

/** A permissive body of API fields, forwarded verbatim to the endpoint. */
function fieldsBody(desc: string): z.ZodType {
  return z.record(z.string(), z.unknown()).describe(desc);
}

/** Optional caller-supplied idempotency key, plumbed to the Idempotency-Key header. */
const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .optional()
  .describe(
    'Optional idempotency key. The server deduplicates by this key for 24h — pass the SAME key when retrying a call whose outcome you did not observe. Without it, each call is a new operation.',
  );

const createRelease: ToolDef = {
  name: 'create_release',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Create a release (draft)',
  description:
    'Create a new release in DRAFT state. Pass its metadata in `fields`. Required: content_type, label_id, artists, titles, cat (catalog number), artwork_ai_usage, primary_genre_id. Pass idempotency_key and reuse the SAME value if you retry a call whose outcome you did not observe — the server deduplicates by it for 24h; without a key each call is a new operation. Add tracks with create_track, then validate_release before distributing.',
  inputShape: {
    fields: fieldsBody(
      'Release metadata. Required: content_type, label_id, artists, titles, cat, artwork_ai_usage, primary_genre_id. Many optional fields (dates, copyright lines, genres, per-outlet URLs) are supported — see the API docs.',
    ),
    idempotency_key: idempotencyKey,
  },
  annotations: {},
  handler: (args, { client }) =>
    client.post('/releases', args.fields, {
      idempotency: true,
      idempotencyKey: args.idempotency_key as string | undefined,
    }),
};

const updateRelease: ToolDef = {
  name: 'update_release',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Update a release',
  description:
    'Update a release’s metadata. Supply only the fields you want to change in `fields`. Once a release has been submitted or distributed, some fields are locked: attempting to change a locked field returns a 403 with code RELEASE_LOCKED_FIELDS, surfaced verbatim so you can see exactly which fields cannot be changed.',
  inputShape: {
    release_id: z.number().int().positive(),
    fields: fieldsBody('Release fields to change (same field set as create_release).'),
  },
  annotations: {},
  handler: (args, { client }) => client.patch(`/releases/${args.release_id}`, args.fields),
};

const deleteRelease: ToolDef = {
  name: 'delete_release',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Delete a release',
  description:
    'Delete a release. The API only allows deleting a draft that has never been submitted; it refuses to delete a release that has been submitted or distributed.',
  inputShape: { release_id: z.number().int().positive() },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.delete(`/releases/${args.release_id}`),
};

const createTrack: ToolDef = {
  name: 'create_track',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Create a track',
  description:
    'Create a track on a release. Pass its metadata in `fields`. Required: release_id, disc, track_num, composition_type, artists, audio_ai_usage, composition_ai_usage, commercial_samples, audio_language, contributors, and recording_country (a required ISO 3166-1 alpha-2 country code, e.g. "US"). Pass idempotency_key and reuse the SAME value if you retry a call whose outcome you did not observe — the server deduplicates by it for 24h; without a key each call is a new operation.',
  inputShape: {
    fields: fieldsBody(
      'Track metadata. Required: release_id, disc, track_num, composition_type, artists, audio_ai_usage, composition_ai_usage, commercial_samples, audio_language, contributors, recording_country (ISO 3166-1 alpha-2). Optional: titles, isrc, iswc, writers, publishers, splits, and more — see the API docs.',
    ),
    idempotency_key: idempotencyKey,
  },
  annotations: {},
  handler: (args, { client }) =>
    client.post('/tracks', args.fields, {
      idempotency: true,
      idempotencyKey: args.idempotency_key as string | undefined,
    }),
};

const updateTrack: ToolDef = {
  name: 'update_track',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Update a track',
  description:
    'Update a track’s metadata. Supply only the fields you want to change in `fields`. As with releases, some fields lock once the parent release is submitted or distributed.',
  inputShape: {
    track_id: z.number().int().positive(),
    fields: fieldsBody('Track fields to change (same field set as create_track).'),
  },
  annotations: {},
  handler: (args, { client }) => client.patch(`/tracks/${args.track_id}`, args.fields),
};

const deleteTrack: ToolDef = {
  name: 'delete_track',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Delete a track',
  description:
    'Delete a track. Allowed while the parent release is an editable draft; the API refuses once the release is submitted or distributed.',
  inputShape: { track_id: z.number().int().positive() },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.delete(`/tracks/${args.track_id}`),
};

const validateRelease: ToolDef = {
  name: 'validate_release',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Validate a release',
  description:
    'Run validation on a release and return any problems that would block distribution, as both a human-readable `errors` list and a machine-readable `errors_structured` list. This is a near-read check: it changes nothing and is safe to repeat. Run it before distributing.',
  inputShape: { release_id: z.number().int().positive() },
  annotations: { idempotentHint: true },
  handler: (args, { client }) => client.post(`/releases/${args.release_id}/validate`),
};

const refreshQualityReport: ToolDef = {
  name: 'refresh_quality_report',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Refresh the quality report',
  description:
    'Re-run the Preflight QC automated checks and refresh the release’s quality report. Read the results with get_quality_report. The server applies an hourly refresh budget, so frequent calls may be rate-limited. Preflight QC is an optional add-on.',
  inputShape: { release_id: z.number().int().positive() },
  annotations: { idempotentHint: true },
  handler: (args, { client }) => client.post(`/releases/${args.release_id}/quality-report/refresh`),
};

const updateLandingConfig: ToolDef = {
  name: 'update_landing_config',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Update a release landing-page config',
  description:
    'Set the smart-link landing-page configuration for a release. `actions` uses the current (v2) action-list contract — each entry describes one call-to-action on the page. You can also set links_page_enabled, config_mode, page_style, custom_cta_text, custom_description, and pre_order_links. This replaces the landing configuration.',
  inputShape: {
    release_id: z.number().int().positive(),
    links_page_enabled: z
      .union([z.boolean(), z.string()])
      .optional()
      .describe('Whether the smart-link page is enabled.'),
    config_mode: z.string().optional(),
    page_style: z.string().optional(),
    custom_cta_text: z.string().optional(),
    custom_description: z.string().optional(),
    actions: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe('The v2 action list — one object per call-to-action on the landing page.'),
    pre_order_links: z.array(z.record(z.string(), z.unknown())).optional(),
  },
  annotations: {},
  handler: (args, { client }) => {
    const { release_id, ...body } = args;
    return client.put(`/releases/${release_id}/landing-config`, body);
  },
};

const createReleaseShortUrl: ToolDef = {
  name: 'create_release_short_url',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Create a release short URL',
  description:
    'Create (or return the existing) short URL for a release’s smart-link landing page. Safe to repeat.',
  inputShape: { release_id: z.number().int().positive() },
  annotations: { idempotentHint: true },
  handler: (args, { client }) =>
    client.post('/releases/short-url', { release_id: args.release_id }),
};

const addReviewIssueNote: ToolDef = {
  name: 'add_review_issue_note',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Add a note to a review issue',
  description:
    'Add a note to a release review issue — for example to explain a fix or add context for the reviewer. `review_issue_id` is the id of the issue (from list_review_issues).',
  inputShape: {
    review_issue_id: z.number().int().positive(),
    note: z.string().describe('The note text to attach to the issue.'),
  },
  annotations: {},
  handler: (args, { client }) =>
    client.post(`/review-issues/${args.review_issue_id}/notes`, { note: args.note }),
};

export const releaseWriteTools: ToolDef[] = [
  createRelease,
  updateRelease,
  deleteRelease,
  createTrack,
  updateTrack,
  deleteTrack,
  validateRelease,
  refreshQualityReport,
  updateLandingConfig,
  createReleaseShortUrl,
  addReviewIssueNote,
];
