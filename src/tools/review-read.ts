/**
 * Review reads: release quality-check issues, the issue-definition catalog,
 * the Preflight QC quality report, and Stream Radar early-warning flags. All
 * read-only, in the `review` toolset.
 */

import { z } from 'zod';
import type { ToolDef } from './types.js';

const listReviewIssues: ToolDef = {
  name: 'list_review_issues',
  toolset: 'review',
  gate: 'read',
  title: 'List release review issues',
  description:
    'List the review issues raised against a release during its automated quality checks. `release_id` is required. Each issue carries a code (see list_issue_definitions for what each code means), severity, and whether it blocks distribution. Use this to see what a customer must fix before a release can go out.',
  inputShape: {
    release_id: z.number().int().positive().describe('The release whose issues to list. Required.'),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get('/review-issues', { release_id: args.release_id }),
};

const listIssueDefinitions: ToolDef = {
  name: 'list_issue_definitions',
  toolset: 'review',
  gate: 'read',
  title: 'List issue definitions',
  description:
    'Retrieve the catalog of review issue definitions: each code’s human-readable title, description, severity and whether it blocks distribution. Use it to interpret the codes returned by list_review_issues and the quality report. Issue codes are string slugs.',
  inputShape: {},
  annotations: { readOnlyHint: true },
  handler: (_args, { client }) => client.get('/issue-definitions'),
};

const getQualityReport: ToolDef = {
  name: 'get_quality_report',
  toolset: 'review',
  gate: 'read',
  title: 'Get a release quality report',
  description:
    'Retrieve the Preflight QC quality report for a release: the customer-facing issues found by the automated checks so you can review them before confirming the release into distribution. Preflight QC is an optional add-on — if your account does not have it enabled the API returns a 403, which is surfaced verbatim.',
  inputShape: { release_id: z.number().int().positive() },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/releases/${args.release_id}/quality-report`),
};

const listStreamRadarFlags: ToolDef = {
  name: 'list_stream_radar_flags',
  toolset: 'review',
  gate: 'read',
  title: 'List Stream Radar flags',
  description:
    'List Stream Radar flags for your releases, paginated — early-warning flags from streaming-integrity monitoring that surface possible artificial-streaming activity so you can act early. Filter by status, severity, dsp, isrc, release_id, and the last-detected date range (detected_from/detected_to). Stream Radar is an optional add-on; without it the API returns a 403, surfaced verbatim.',
  inputShape: {
    page: z.number().int().positive().optional(),
    per_page: z.number().int().positive().optional(),
    status: z.string().optional().describe('Filter by flag status.'),
    severity: z.string().optional().describe('Filter by severity.'),
    dsp: z.string().optional().describe('Filter by platform/DSP.'),
    isrc: z.string().optional(),
    release_id: z.number().int().positive().optional(),
    detected_from: z.string().optional().describe('Earliest last-detected date, YYYY-MM-DD.'),
    detected_to: z.string().optional().describe('Latest last-detected date, YYYY-MM-DD.'),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => {
    const { page, per_page, ...filter } = args;
    return client.get('/stream-radar/flags', { page, per_page, filter });
  },
};

const getStreamRadarFlag: ToolDef = {
  name: 'get_stream_radar_flag',
  toolset: 'review',
  gate: 'read',
  title: 'Get a Stream Radar flag',
  description:
    'Retrieve one Stream Radar flag by id, with its full detail. Stream Radar is an optional add-on; without it the API returns a 403, surfaced verbatim.',
  inputShape: { flag_id: z.number().int().positive() },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/stream-radar/flags/${args.flag_id}`),
};

export const reviewReadTools: ToolDef[] = [
  listReviewIssues,
  listIssueDefinitions,
  getQualityReport,
  listStreamRadarFlags,
  getStreamRadarFlag,
];
