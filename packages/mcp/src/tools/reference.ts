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
    'Fetch a LabelGrid reference dataset used to resolve the IDs and codes the catalog and release tools expect. Pick ONE dataset with `type`: ' +
    '`genres` and `genre_categories` (genre IDs), `languages` (audio/metadata language codes), `contributor_roles`, `instruments`, `distro_outlets` (the outlets/stores available to you), ' +
    '`territories` (country codes), `issue_definitions` (review issue codes — string slugs — with severity and whether they block distribution), ' +
    'or `webhook_event_types` (event types with their payload schemas). ' +
    'Also exposed as MCP resources at labelgrid://reference/{type}; this tool is the fallback.',
  inputShape: {
    type: z.enum(REFERENCE_TYPES),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(REFERENCE_DATASETS[args.type as ReferenceType].path),
};

export const referenceTools: ToolDef[] = [listReferenceData];
