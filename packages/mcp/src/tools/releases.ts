/**
 * Releases toolset: release-level reads (review results, delivery status,
 * the smart-link landing config, track licenses, review documents) plus the
 * safe-write release checks, landing-page management and review-issue notes,
 * and the full-write review-document upload.
 *
 * The two [proj] reads (`get_release_review`, `get_delivery_queue`) default to
 * concise-mode projection; `response_format: 'detailed'` returns the verbatim
 * API response.
 */

import { statSync } from 'node:fs';
import { type ApiResult, assertAllowedExtension } from '@labelgrid/core';
import { z } from 'zod';
import { applyProjection } from '../projection.js';
import type { ToolDef } from './types.js';

const releaseId = z.number().int().positive().describe('The release id.');

const responseFormat = z
  .enum(['concise', 'detailed'])
  .optional()
  .describe(
    "'concise' (default) keeps high-signal fields and ids; 'detailed' is the verbatim response.",
  );

/** A positive decimal id, as a number or as the string a list response returns. */
const decimalId = z.union([
  z.string().regex(/^[1-9][0-9]*$/),
  // Only ids a number holds exactly; a larger id goes as a decimal string.
  z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
]);

/** Reduces each listed review document's `tracks` to `track_ids`; `upload` is kept whole. */
function slimReviewDocuments(result: ApiResult<unknown>): ApiResult<unknown> {
  if (!('data' in result)) return result;
  const body = result.data as Record<string, unknown> | null;
  if (body === null || typeof body !== 'object' || !Array.isArray(body.data)) return result;
  return {
    data: {
      ...body,
      data: body.data.map((doc: unknown) => {
        if (doc === null || typeof doc !== 'object') return doc;
        const { tracks, ...rest } = doc as Record<string, unknown>;
        if (!Array.isArray(tracks)) return doc;
        return {
          ...rest,
          track_ids: tracks.map((t: unknown) =>
            t !== null && typeof t === 'object' ? (t as { id?: unknown }).id : t,
          ),
        };
      }),
    },
  };
}

const getReleaseReview: ToolDef = {
  name: 'get_release_review',
  toolset: 'releases',
  gate: 'read',
  title: 'Get release review results',
  description:
    "Read a release's review. Pick ONE `view`: " +
    '`issues`: review issues, each with a code (see list_reference_data issue_definitions), severity and whether it blocks distribution. ' +
    '`quality_report`: the Preflight QC report to check before confirming distribution (an optional add-on; 403 without it). ' +
    '`documents`: review documents and the requests an upload can answer. ' +
    '`document_download`: a temporary link for `review_document_id`, fetched without the LabelGrid token. ' +
    '`response_format` applies to issues and quality_report only.',
  inputShape: {
    release_id: releaseId,
    view: z
      .enum(['issues', 'quality_report', 'documents', 'document_download'])
      .describe('Which review read.'),
    review_document_id: z.number().int().positive().optional(),
    response_format: responseFormat,
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    if (args.view === 'documents') {
      return slimReviewDocuments(await client.get(`/releases/${args.release_id}/review-documents`));
    }
    if (args.view === 'document_download') {
      if (args.review_document_id === undefined) {
        return {
          error: {
            code: 'INVALID_SELECTOR',
            message:
              "view 'document_download' requires `review_document_id` — a document id from view documents.",
            status: 0,
          },
        };
      }
      return client.get(
        `/releases/${args.release_id}/review-documents/${String(args.review_document_id)}/download`,
      );
    }
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
  title: 'Get release delivery status',
  description:
    "Read a release's canonical delivery status: its overall state, current and historical delivery predicates, and one current state per outlet. Each outlet also reports its latest completed work (`latest_success`) and whether the release is live there (`currently_live`). The API owns all queue-history interpretation. A release outside your account is indistinguishable from an unknown release (`RELEASE_NOT_ACCESSIBLE`).",
  inputShape: {
    release_id: releaseId,
    response_format: responseFormat,
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const result = await client.get(`/releases/${args.release_id}/delivery-status`);
    return applyProjection(result, 'get_delivery_queue', args.response_format);
  },
};

const getReleaseProfileProtection: ToolDef = {
  name: 'get_release_profile_protection',
  toolset: 'releases',
  gate: 'read',
  title: 'Get Spotify profile protection',
  description:
    "Read whether Spotify keeps a release off the artist's profile until the artist approves it in Spotify for Artists: status and synced_at.",
  inputShape: { release_id: releaseId },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/releases/${args.release_id}/profile-protection`),
};

const getLandingConfig: ToolDef = {
  name: 'get_landing_config',
  toolset: 'releases',
  gate: 'read',
  title: 'Get a release landing-page config',
  description:
    "Retrieve a release's smart-link landing-page configuration: enabled state, style/mode, custom copy, action list, pre-order links. Change it via manage_release_links (action update_landing_config).",
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
    "List a track's licenses (e.g. cover/mechanical or sample clearances), paginated. Pass `license_id` to retrieve one license instead.",
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
    '`validate` returns problems that would block distribution (human-readable `errors` + machine-readable `errors_structured`); it changes nothing and is safe to repeat — run it before distributing. ' +
    '`refresh_quality_report` re-runs the Preflight QC checks (read the report with get_release_review view quality_report); an hourly refresh budget may rate-limit frequent calls. Preflight QC is an optional add-on.',
  inputShape: {
    release_id: releaseId,
    check: z.enum(['validate', 'refresh_quality_report']).describe('Which check to run.'),
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
    '`update_landing_config` replaces the configuration with `config` (required for this action) — `config.actions` uses the v2 action-list contract (one entry per call-to-action); other keys: links_page_enabled, config_mode, page_style, custom_cta_text, custom_description, pre_order_links. ' +
    '`create_short_url` creates (or returns the existing) short URL for the landing page — safe to repeat.',
  inputShape: {
    release_id: releaseId,
    action: z.enum(['update_landing_config', 'create_short_url']).describe('Which action.'),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The landing-page configuration to set (required for update_landing_config).'),
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
    'Add a note to a release review issue — to explain a fix or add reviewer context. `review_issue_id` comes from get_release_review view issues.',
  inputShape: {
    review_issue_id: z.number().int().positive(),
    note: z.string().describe('The note text to attach to the issue.'),
  },
  annotations: {},
  handler: (args, { client }) =>
    client.post(`/review-issues/${args.review_issue_id}/notes`, { note: args.note }),
};

const REVIEW_DOCUMENT_EXTS = ['.pdf', '.jpg', '.jpeg', '.png'];
const REVIEW_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

const uploadReviewDocument: ToolDef = {
  name: 'upload_review_document',
  toolset: 'releases',
  gate: 'full_write',
  title: 'Upload a review document',
  description:
    'Upload a PDF/JPG/PNG review document, max 20 MB. To answer a request, pass review_issue_id from get_release_review view documents (answerable_issues: accepted types, scope; track scope needs track_ids). Without it: a general upload. Retry with the same key and file.',
  inputShape: {
    release_id: z.number().int().positive(),
    file_path: z.string(),
    type: z.enum([
      'ai_statement',
      'rights_proof',
      'artist_authorization',
      'split_sheet',
      'remix_authorization',
    ]),
    review_issue_id: decimalId.optional(),
    track_ids: z.array(z.number().int().positive()).min(1).max(200).optional(),
    idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  },
  annotations: { destructiveHint: false },
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const ext = assertAllowedExtension(args.file_path as string, REVIEW_DOCUMENT_EXTS);
    if ('error' in ext) return { error: ext.error };
    // The device and inode at the checked path, taken now: core refuses to send a
    // different file if the path is replaced between this stat and its open.
    let identity: { dev: bigint; ino: bigint };
    try {
      const { dev, ino } = statSync(ext.realPath, { bigint: true });
      identity = { dev, ino };
    } catch (err) {
      return {
        error: {
          code: 'FILE_NOT_FOUND',
          message: `Could not read file at ${ext.realPath}: ${err instanceof Error ? err.message : 'unknown error'}`,
          status: 0,
        },
      };
    }
    const extra: Record<string, string | string[]> = { type: String(args.type) };
    if (args.review_issue_id !== undefined) extra.review_issue_id = String(args.review_issue_id);
    if (Array.isArray(args.track_ids)) {
      // Sorted and deduplicated, so a retry under the same key sends the same request.
      extra.track_ids = [...new Set(args.track_ids as number[])].sort((a, b) => a - b).map(String);
    }
    return client.postMultipart(
      `/releases/${args.release_id}/review-documents`,
      ext.realPath,
      'file',
      extra,
      {
        idempotency: true,
        idempotencyKey: args.idempotency_key as string,
        maxBytes: REVIEW_DOCUMENT_MAX_BYTES,
        expectIdentity: identity,
      },
    );
  },
};

export const releaseTools: ToolDef[] = [
  getReleaseReview,
  getDeliveryQueue,
  getReleaseProfileProtection,
  getLandingConfig,
  listTrackLicenses,
  runReleaseChecks,
  manageReleaseLinks,
  addReviewIssueNote,
  uploadReviewDocument,
];
