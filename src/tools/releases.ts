/**
 * Releases toolset: release-level reads (review results, the delivery queue,
 * the smart-link landing config, track licenses) plus the safe-write release
 * checks, landing-page management and review-issue notes.
 *
 * The two [proj] reads (`get_release_review`, `get_delivery_queue`) default to
 * concise-mode projection; `response_format: 'detailed'` returns the verbatim
 * API response.
 */

import { z } from 'zod';
import { applyProjection } from '../projection.js';
import type { ToolDef } from './types.js';

const releaseId = z.number().int().positive().describe('The release id.');

const responseFormat = z
  .enum(['concise', 'detailed'])
  .optional()
  .describe(
    "Response shape: 'concise' (default) projects the response down to the high-signal fields (ids are always kept); 'detailed' returns the verbatim API response.",
  );

const getReleaseReview: ToolDef = {
  name: 'get_release_review',
  toolset: 'releases',
  gate: 'read',
  title: 'Get release review results',
  description:
    "Read a release's automated quality-check results. Pick ONE view with `view`: " +
    '`issues` lists the review issues raised against the release during its automated quality checks — each issue carries a code (see list_reference_data type issue_definitions for what each code means), severity, and whether it blocks distribution; use it to see what a customer must fix before a release can go out. ' +
    '`quality_report` retrieves the Preflight QC quality report — the customer-facing issues found by the automated checks so you can review them before confirming the release into distribution; Preflight QC is an optional add-on — if your account does not have it enabled the API returns a 403, which is surfaced verbatim. ' +
    "response_format:'detailed' returns the verbatim API response.",
  inputShape: {
    release_id: releaseId,
    view: z
      .enum(['issues', 'quality_report'])
      .describe('Which review read: issues (review issues) or quality_report (Preflight QC).'),
    response_format: responseFormat,
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const result =
      args.view === 'quality_report'
        ? await client.get(`/releases/${args.release_id}/quality-report`)
        : await client.get('/review-issues', { release_id: args.release_id });
    return applyProjection(result, 'get_release_review', args.response_format);
  },
};

const getDeliveryQueue: ToolDef = {
  name: 'get_delivery_queue',
  toolset: 'releases',
  gate: 'read',
  title: 'Get the distribution queue',
  description:
    'List the distribution queue entries for your account, paginated — one entry per (release, outlet) delivery with its current status (e.g. pending review, processing, scheduled, complete, error). Filter by `release_id`, `outlet_id`, or `status`. Use this to see where a release is in the delivery pipeline to each store. ' +
    "response_format:'detailed' returns the verbatim API response.",
  inputShape: {
    release_id: z.number().int().positive().optional().describe('Filter to one release.'),
    outlet_id: z.number().int().positive().optional().describe('Filter to one outlet/store.'),
    status: z.string().optional().describe('Filter by delivery status.'),
    page: z.number().int().positive().optional(),
    per_page: z.number().int().positive().optional(),
    response_format: responseFormat,
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const result = await client.get('/queues/distro', {
      page: args.page,
      per_page: args.per_page,
      filter: {
        release_id: args.release_id,
        outlet_id: args.outlet_id,
        status: args.status,
      },
    });
    return applyProjection(result, 'get_delivery_queue', args.response_format);
  },
};

const getLandingConfig: ToolDef = {
  name: 'get_landing_config',
  toolset: 'releases',
  gate: 'read',
  title: 'Get a release landing-page config',
  description:
    'Retrieve the smart-link landing-page configuration for a release: whether the links page is enabled, its style/mode, custom copy, the action list and any pre-order links. Pair with manage_release_links (action update_landing_config) to change it.',
  inputShape: { release_id: releaseId },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/releases/${args.release_id}/landing-config`),
};

const listTrackLicenses: ToolDef = {
  name: 'list_track_licenses',
  toolset: 'releases',
  gate: 'read',
  title: 'List track licenses',
  description:
    'List the licenses attached to a track (e.g. cover/mechanical or sample clearances), paginated. Pass `license_id` to retrieve one license by its id instead.',
  inputShape: {
    track_id: z.number().int().positive().describe('The track id.'),
    license_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Retrieve one license by id instead of listing.'),
    page: z.number().int().positive().optional(),
    per_page: z.number().int().positive().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => {
    if (args.license_id !== undefined) {
      return client.get(`/tracks/${args.track_id}/licenses/${args.license_id}`);
    }
    return client.get(`/tracks/${args.track_id}/licenses`, {
      page: args.page,
      per_page: args.per_page,
    });
  },
};

const runReleaseChecks: ToolDef = {
  name: 'run_release_checks',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Run release checks',
  description:
    'Run an automated check on a release. Pick ONE with `check`: ' +
    '`validate` runs validation and returns any problems that would block distribution, as both a human-readable `errors` list and a machine-readable `errors_structured` list — a near-read check: it changes nothing and is safe to repeat; run it before distributing. ' +
    "`refresh_quality_report` re-runs the Preflight QC automated checks and refreshes the release's quality report (read the results with get_release_review view quality_report); the server applies an hourly refresh budget, so frequent calls may be rate-limited. Preflight QC is an optional add-on.",
  inputShape: {
    release_id: releaseId,
    check: z
      .enum(['validate', 'refresh_quality_report'])
      .describe('Which check to run: validate or refresh_quality_report.'),
  },
  annotations: { idempotentHint: true },
  handler: (args, { client }) =>
    args.check === 'refresh_quality_report'
      ? client.post(`/releases/${args.release_id}/quality-report/refresh`)
      : client.post(`/releases/${args.release_id}/validate`),
};

const manageReleaseLinks: ToolDef = {
  name: 'manage_release_links',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Manage a release smart link',
  description:
    "Manage a release's smart-link landing page. Pick ONE action with `action`: " +
    '`update_landing_config` sets the landing-page configuration — pass it in `config` (required for this action). `config.actions` uses the current (v2) action-list contract — each entry describes one call-to-action on the page — and you can also set links_page_enabled, config_mode, page_style, custom_cta_text, custom_description, and pre_order_links; this replaces the landing configuration. ' +
    "`create_short_url` creates (or returns the existing) short URL for the release's smart-link landing page — safe to repeat.",
  inputShape: {
    release_id: releaseId,
    action: z
      .enum(['update_landing_config', 'create_short_url'])
      .describe('Which action: update_landing_config or create_short_url.'),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'The landing-page configuration to set (required for update_landing_config): actions (the v2 action list), links_page_enabled, config_mode, page_style, custom_cta_text, custom_description, pre_order_links.',
      ),
  },
  annotations: {},
  handler: (args, { client }) => {
    if (args.action === 'create_short_url') {
      return client.post('/releases/short-url', { release_id: args.release_id });
    }
    if (args.config === undefined) {
      return Promise.resolve({
        error: {
          code: 'INVALID_SELECTOR',
          message:
            "action 'update_landing_config' requires `config` — the landing-page configuration to set.",
          status: 0,
        },
      });
    }
    return client.put(`/releases/${args.release_id}/landing-config`, args.config);
  },
};

const addReviewIssueNote: ToolDef = {
  name: 'add_review_issue_note',
  toolset: 'releases',
  gate: 'safe_write',
  title: 'Add a note to a review issue',
  description:
    'Add a note to a release review issue — for example to explain a fix or add context for the reviewer. `review_issue_id` is the id of the issue (from get_release_review view issues).',
  inputShape: {
    review_issue_id: z.number().int().positive(),
    note: z.string().describe('The note text to attach to the issue.'),
  },
  annotations: {},
  handler: (args, { client }) =>
    client.post(`/review-issues/${args.review_issue_id}/notes`, { note: args.note }),
};

export const releaseTools: ToolDef[] = [
  getReleaseReview,
  getDeliveryQueue,
  getLandingConfig,
  listTrackLicenses,
  runReleaseChecks,
  manageReleaseLinks,
  addReviewIssueNote,
];
