/**
 * Catalog read toolset: paginated collection listings and single-item reads for
 * labels, artists, writers, publishers, releases and tracks.
 *
 * Every list tool accepts `page`/`per_page` plus the endpoint's documented
 * `filter[...]` parameters; the handler nests the filter fields so the client
 * serializes them as `filter[key]=value`.
 */

import { z } from 'zod';
import type { ToolDef } from './types.js';

const page = z.number().int().positive().optional().describe('1-based page number.');
const perPage = z.number().int().positive().optional().describe('Items per page.');

/** Builds a paginated list tool whose extra input fields become `filter[...]`. */
function listTool(spec: {
  name: string;
  path: string;
  title: string;
  description: string;
  filters: z.ZodRawShape;
}): ToolDef {
  return {
    name: spec.name,
    toolset: 'catalog',
    gate: 'read',
    title: spec.title,
    description: spec.description,
    inputShape: { page, per_page: perPage, ...spec.filters },
    annotations: { readOnlyHint: true },
    handler: (args, { client }) => {
      const { page: p, per_page: pp, ...filter } = args;
      return client.get(spec.path, { page: p, per_page: pp, filter });
    },
  };
}

/** Builds a single-item read tool keyed by a positive integer id. */
function getTool(spec: {
  name: string;
  idField: string;
  basePath: string;
  title: string;
  description: string;
}): ToolDef {
  return {
    name: spec.name,
    toolset: 'catalog',
    gate: 'read',
    title: spec.title,
    description: spec.description,
    inputShape: { [spec.idField]: z.number().int().positive() },
    annotations: { readOnlyHint: true },
    handler: (args, { client }) => client.get(`${spec.basePath}/${args[spec.idField]}`),
  };
}

export const catalogReadTools: ToolDef[] = [
  listTool({
    name: 'list_labels',
    path: '/labels',
    title: 'List labels',
    description:
      'List the labels in your account, paginated. A label groups your releases and carries default copyright, website and outlet settings. Use get_label for the full detail of one label.',
    filters: {},
  }),
  getTool({
    name: 'get_label',
    idField: 'label_id',
    basePath: '/labels',
    title: 'Get a label',
    description: 'Retrieve one label by id, including its settings and defaults.',
  }),
  listTool({
    name: 'list_artists',
    path: '/artists',
    title: 'List artists',
    description:
      'List the artists in your account, paginated. Filter by `artist_name` to find a specific artist. Use get_artist for one artist’s full profile and links.',
    filters: { artist_name: z.string().optional().describe('Filter by artist name.') },
  }),
  getTool({
    name: 'get_artist',
    idField: 'artist_id',
    basePath: '/artists',
    title: 'Get an artist',
    description: 'Retrieve one artist by id, including bio, identifiers and platform links.',
  }),
  listTool({
    name: 'list_writers',
    path: '/writers',
    title: 'List writers',
    description:
      'List the songwriters in your account, paginated. Filter by `name` or `ipi`. Writers are attached to tracks for composition credits and royalty splits.',
    filters: {
      name: z.string().optional().describe('Filter by writer name.'),
      ipi: z.string().optional().describe('Filter by IPI number.'),
    },
  }),
  getTool({
    name: 'get_writer',
    idField: 'writer_id',
    basePath: '/writers',
    title: 'Get a writer',
    description: 'Retrieve one writer by id, including PRO/IPI identifiers and publisher link.',
  }),
  listTool({
    name: 'list_publishers',
    path: '/publishers',
    title: 'List publishers',
    description:
      'List the publishers in your account, paginated. Filter by `name` or `ipi`. Publishers are linked to writers for publishing administration.',
    filters: {
      name: z.string().optional().describe('Filter by publisher name.'),
      ipi: z.string().optional().describe('Filter by IPI number.'),
    },
  }),
  getTool({
    name: 'get_publisher',
    idField: 'publisher_id',
    basePath: '/publishers',
    title: 'Get a publisher',
    description: 'Retrieve one publisher by id.',
  }),
  listTool({
    name: 'list_releases',
    path: '/releases',
    title: 'List releases',
    description:
      'List releases in your account, paginated. Filter by `label_id`, `is_live` (1 = live/distributed), `barcode_number` (UPC/EAN), or `cat` (catalog number). Use get_release for one release’s full metadata and track listing.',
    filters: {
      label_id: z.number().int().positive().optional().describe('Filter by owning label id.'),
      is_live: z.number().int().optional().describe('1 to return only live/distributed releases.'),
      barcode_number: z.string().optional().describe('Filter by UPC/EAN barcode.'),
      cat: z.string().optional().describe('Filter by catalog number.'),
    },
  }),
  getTool({
    name: 'get_release',
    idField: 'release_id',
    basePath: '/releases',
    title: 'Get a release',
    description:
      'Retrieve one release by id, including its metadata, artwork state and track listing.',
  }),
  listTool({
    name: 'list_tracks',
    path: '/tracks',
    title: 'List tracks',
    description:
      'List tracks in your account, paginated. Filter by `release_id` to list a release’s tracks, or by `isrc`. Use get_track for one track’s full metadata, credits and splits.',
    filters: {
      release_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Filter to one release’s tracks.'),
      isrc: z.string().optional().describe('Filter by ISRC.'),
    },
  }),
  getTool({
    name: 'get_track',
    idField: 'track_id',
    basePath: '/tracks',
    title: 'Get a track',
    description:
      'Retrieve one track by id, including titles, contributors, writers, publishers and royalty splits.',
  }),
];
