/** Reference toolset: one tool serving all read-only lookup datasets. */

import { z } from 'zod';
import { REFERENCE_DATASETS, REFERENCE_TYPES, type ReferenceType } from '../resources.js';
import type { ToolDef } from './types.js';

const listReferenceData: ToolDef = {
  name: 'list_reference_data',
  toolset: 'reference',
  gate: 'read',
  title: 'List reference data',
  description:
    'Fetch a LabelGrid reference dataset used to resolve the IDs and codes that catalog and release tools expect. Pick ONE dataset with `type`: ' +
    '`genres` and `genre_categories` (values for primary/secondary/tertiary genre IDs), `languages` (audio and metadata language codes), ' +
    '`contributor_roles` (valid role names for track contributors), `instruments`, `distro_outlets` (the distribution outlets/stores available to your account), ' +
    '`territories` (country/territory codes), `issue_definitions` (the catalog of review issue definitions — each code’s human-readable title, description, severity and whether it blocks distribution; issue codes are string slugs), ' +
    'or `webhook_event_types` (every available webhook event type with the schema of the payload it delivers — use it to decide which events to subscribe a webhook to). ' +
    'Call this before creating or updating a release or track when you need a valid ID or code. ' +
    'The same datasets are exposed as MCP resources at labelgrid://reference/{type}; this tool is the fallback for clients that don’t surface resources.',
  inputShape: {
    type: z.enum(REFERENCE_TYPES),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(REFERENCE_DATASETS[args.type as ReferenceType].path),
};

export const referenceTools: ToolDef[] = [listReferenceData];
