/** Reference toolset: one tool serving all read-only lookup datasets. */

import { z } from 'zod';
import type { ToolDef } from './types.js';

/** Maps the public `type` selector to its reference endpoint. */
const REFERENCE_PATHS: Record<string, string> = {
  genres: '/genres',
  genre_categories: '/genre-categories',
  languages: '/languages',
  contributor_roles: '/contributor-roles',
  instruments: '/instruments',
  distro_outlets: '/distro-outlets',
  territories: '/territories',
};

const listReferenceData: ToolDef = {
  name: 'list_reference_data',
  toolset: 'reference',
  gate: 'read',
  title: 'List reference data',
  description:
    'Fetch a LabelGrid reference dataset used to resolve the IDs and codes that catalog and release tools expect. Pick ONE dataset with `type`: ' +
    '`genres` and `genre_categories` (values for primary/secondary/tertiary genre IDs), `languages` (audio and metadata language codes), ' +
    '`contributor_roles` (valid role names for track contributors), `instruments`, `distro_outlets` (the distribution outlets/stores available to your account), ' +
    'or `territories` (country/territory codes). Call this before creating or updating a release or track when you need a valid ID or code.',
  inputShape: {
    type: z.enum([
      'genres',
      'genre_categories',
      'languages',
      'contributor_roles',
      'instruments',
      'distro_outlets',
      'territories',
    ]),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(REFERENCE_PATHS[args.type as string]),
};

export const referenceTools: ToolDef[] = [listReferenceData];
