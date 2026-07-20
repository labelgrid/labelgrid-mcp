/**
 * Catalog toolset: the consolidated entity CRUD (search/get/create/update/
 * delete across labels, artists, writers, publishers, releases and tracks),
 * image uploads, and the asset read (`get_asset`).
 *
 * Every tool selects its entity via the registry in `src/entities.ts`.
 * Create/update forward a permissive `fields` object straight to the API,
 * which owns all validation — this keeps each tool a thin wrapper and lets the
 * full documented field set through without re-declaring it here. The two
 * reads are [proj] tools: concise-mode projection by default, with
 * `response_format: 'detailed'` returning the verbatim API response.
 */

import { statSync } from 'node:fs';
import { z } from 'zod';
import { assertAllowedExtension } from '../api/content-types.js';
import type { ApiError, ApiResult } from '../api/http.js';
import { ENTITIES, ENTITY_NAMES, type EntityName } from '../entities.js';
import { applyProjection } from '../projection.js';
import type { ToolDef } from './types.js';

/** Accepted image extensions for the catalog image uploads. */
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];

const entityArg = z.enum(ENTITY_NAMES).describe('The catalog entity kind.');

const idArg = z.number().int().positive().describe('The entity id.');

const responseFormat = z
  .enum(['concise', 'detailed'])
  .optional()
  .describe(
    "'concise' (default) keeps only the high-signal fields (ids always kept); 'detailed' returns the verbatim API response.",
  );

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
    'Honored for release and track only: the server deduplicates by this key for 24h — reuse the SAME key when retrying an unobserved call. Ignored for other entities.',
  );

/** Rejects a path that is not an existing regular file, before any HTTP call. */
function fileError(p: string): ApiError | null {
  let isFile = false;
  try {
    isFile = statSync(p).isFile();
  } catch {
    isFile = false;
  }
  return isFile
    ? null
    : { code: 'FILE_NOT_FOUND', message: `No readable file at ${p}.`, status: 0 };
}

function entityDoc(pick: (spec: (typeof ENTITIES)[EntityName]) => string): string {
  return ENTITY_NAMES.map((name) => pick(ENTITIES[name])).join(' ');
}

const searchCatalog: ToolDef = {
  name: 'search_catalog',
  toolset: 'catalog',
  gate: 'read',
  title: 'Search the catalog',
  description: `List catalog entities of one kind, paginated. Pick the kind with \`entity\`: label, artist, writer, publisher, release, or track. \`filters\` takes the endpoint’s own filter names, passed through verbatim — ${entityDoc(
    (s) => s.filtersDoc,
  )} Use get_catalog_item for one entity's full detail. response_format:'detailed' returns the verbatim API response.`,
  inputShape: {
    entity: entityArg,
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Filter names → values, passed through verbatim.'),
    page: z.number().int().positive().optional().describe('1-based page number.'),
    per_page: z.number().int().positive().optional().describe('Items per page.'),
    response_format: responseFormat,
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const spec = ENTITIES[args.entity as EntityName];
    const result = await client.get(spec.path, {
      page: args.page,
      per_page: args.per_page,
      filter: args.filters,
    });
    return applyProjection(result, 'search_catalog', args.response_format);
  },
};

const getCatalogItem: ToolDef = {
  name: 'get_catalog_item',
  toolset: 'catalog',
  gate: 'read',
  title: 'Get a catalog item',
  description:
    'Retrieve one catalog entity by id, with its full detail — a label’s settings, an artist’s identifiers and links, a writer’s PRO/IPI, a release’s metadata and track listing, a track’s contributors and royalty splits. ' +
    "Pick the kind with `entity`: label, artist, writer, publisher, release, or track. response_format:'detailed' returns the verbatim API response.",
  inputShape: {
    entity: entityArg,
    id: idArg,
    response_format: responseFormat,
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const spec = ENTITIES[args.entity as EntityName];
    const result = await client.get(`${spec.path}/${args.id}`);
    return applyProjection(result, 'get_catalog_item', args.response_format);
  },
};

const createCatalogItem: ToolDef = {
  name: 'create_catalog_item',
  toolset: 'catalog',
  gate: 'safe_write',
  title: 'Create a catalog item',
  description: `Create a catalog entity. Pick the kind with \`entity\` and pass its attributes in \`fields\` — the API owns all validation. Required and common fields per entity: ${entityDoc(
    (s) => s.fieldsDoc,
  )} A release is created in DRAFT state — add tracks, then run the release checks before distributing. \`idempotency_key\` is honored for release and track only.`,
  inputShape: {
    entity: entityArg,
    fields: fieldsBody('The entity attributes, forwarded verbatim.'),
    idempotency_key: idempotencyKey,
  },
  annotations: {},
  handler: (args, { client }) => {
    const entity = args.entity as EntityName;
    const spec = ENTITIES[entity];
    // Only the release and track POST endpoints support idempotency keys — the
    // header is never sent for the other entities (their endpoints lack it).
    if (entity === 'release' || entity === 'track') {
      return client.post(spec.path, args.fields, {
        idempotency: true,
        idempotencyKey: args.idempotency_key as string | undefined,
      });
    }
    return client.post(spec.path, args.fields);
  },
};

const updateCatalogItem: ToolDef = {
  name: 'update_catalog_item',
  toolset: 'catalog',
  gate: 'safe_write',
  title: 'Update a catalog item',
  description:
    'Update a catalog entity. Pick the kind with `entity`, supply only the fields you want to change in `fields` (same field sets as create_catalog_item). ' +
    'For releases: once submitted or distributed, some fields are locked — changing one returns a 403 with code RELEASE_LOCKED_FIELDS naming exactly which fields cannot change. Track fields lock the same way once the parent release is submitted or distributed.',
  inputShape: {
    entity: entityArg,
    id: idArg,
    fields: fieldsBody('The fields to change, forwarded verbatim.'),
  },
  annotations: { idempotentHint: true },
  handler: (args, { client }) => {
    const spec = ENTITIES[args.entity as EntityName];
    return client.patch(`${spec.path}/${args.id}`, args.fields);
  },
};

const deleteCatalogItem: ToolDef = {
  name: 'delete_catalog_item',
  toolset: 'catalog',
  gate: 'safe_write',
  title: 'Delete a catalog item',
  description: `Delete a catalog entity by id. The API refuses deletes that would orphan data — ${entityDoc(
    (s) => s.deleteNote,
  )}`,
  inputShape: { entity: entityArg, id: idArg },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => {
    const spec = ENTITIES[args.entity as EntityName];
    return client.delete(`${spec.path}/${args.id}`);
  },
};

/** Maps the label image targets to the API's imageType path segment. */
const LABEL_IMAGE_TYPES: Record<string, string> = {
  label_logo: 'logo',
  label_logo_dark: 'logo-dark',
  label_background: 'background',
};

const uploadImage: ToolDef = {
  name: 'upload_image',
  toolset: 'catalog',
  gate: 'safe_write',
  title: 'Upload a catalog image',
  description:
    'Upload a label image or an artist photo from a local file. `target`: label_logo, label_logo_dark (a dark-mode variant), label_background, or artist_photo. `id` is the label id for label_* and the artist id for artist_photo. `file_path` must be a local image file.',
  inputShape: {
    target: z
      .enum(['label_logo', 'label_logo_dark', 'label_background', 'artist_photo'])
      .describe('Which image asset to upload.'),
    id: z.number().int().positive().describe('The label id (label_*) or artist id (artist_photo).'),
    file_path: z.string().describe('Local path to the image file to upload.'),
  },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const err = fileError(args.file_path as string);
    if (err) return { error: err };
    const ext = assertAllowedExtension(args.file_path as string, IMAGE_EXTS);
    if ('error' in ext) return { error: ext.error };
    const target = args.target as string;
    if (target === 'artist_photo') {
      return client.postMultipart(`/artists/${args.id}/photo`, ext.realPath, 'file');
    }
    return client.postMultipart(
      `/labels/${args.id}/images/${LABEL_IMAGE_TYPES[target]}`,
      ext.realPath,
      'file',
    );
  },
};

/** The (mode, parent) → allowed-assets matrix — the only combinations with an endpoint. */
const INFO_TRACK_ASSETS = new Set(['stereo', 'dolby', 'lyrics']);
const INFO_RELEASE_ASSETS = new Set(['square', 'tall']);
const DOWNLOAD_TRACK_ASSETS = new Set([
  'audio_16',
  'audio_24',
  'audio_32',
  'audio_preview_full',
  'audio_preview_clip',
]);

const GET_ASSET_VALID_COMBINATIONS =
  'Valid combinations: mode=info + parent=track + asset stereo|dolby|lyrics (file metadata and processing state); ' +
  'mode=info + parent=release + asset square|tall (animated cover / motion artwork video metadata); ' +
  'mode=download_url + parent=track + asset audio_16|audio_24|audio_32|audio_preview_full|audio_preview_clip (a signed download URL).';

const getAsset: ToolDef = {
  name: 'get_asset',
  toolset: 'catalog',
  gate: 'read',
  title: 'Get an asset',
  description:
    'Read a track or release asset. Valid selector matrices: ' +
    "(1) mode='info', parent='track', asset stereo|dolby|lyrics — file metadata (not the bytes) incl. processing state. " +
    "(2) mode='info', parent='release', asset square|tall — animated cover (motion artwork) video metadata incl. processing state. " +
    "(3) mode='download_url', parent='track', asset audio_16|audio_24|audio_32 (WAV master at that bit depth) or audio_preview_full|audio_preview_clip (generated MP3 preview) — returns { download_url, expires_in }: a signed URL that expires roughly 10 minutes after issue; fetch it directly — do not send your API token to it. " +
    'Any other combination has no endpoint and returns a structured error. mode defaults to info.',
  inputShape: {
    parent: z.enum(['track', 'release']).describe('Whose asset.'),
    id: z.number().int().positive().describe('The track id or release id, per `parent`.'),
    asset: z
      .enum([
        'stereo',
        'dolby',
        'lyrics',
        'square',
        'tall',
        'audio_16',
        'audio_24',
        'audio_32',
        'audio_preview_full',
        'audio_preview_clip',
      ])
      .describe('Which asset — see the description for the valid parent/mode pairings.'),
    mode: z
      .enum(['info', 'download_url'])
      .optional()
      .describe('info (default) returns file metadata; download_url returns a signed URL.'),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => {
    const mode = (args.mode as string | undefined) ?? 'info';
    const parent = args.parent as string;
    const asset = args.asset as string;
    if (mode === 'info' && parent === 'track' && INFO_TRACK_ASSETS.has(asset)) {
      return client.get(`/tracks/${args.id}/files/${asset}`);
    }
    if (mode === 'info' && parent === 'release' && INFO_RELEASE_ASSETS.has(asset)) {
      return client.get(`/releases/${args.id}/files/${asset}`);
    }
    if (mode === 'download_url' && parent === 'track' && DOWNLOAD_TRACK_ASSETS.has(asset)) {
      return client.get(`/tracks/${args.id}/files/${asset}/download-url`);
    }
    // No endpoint exists for this combination — there is nothing to send it to.
    return Promise.resolve({
      error: {
        code: 'INVALID_SELECTOR',
        message: `No endpoint exists for mode=${mode}, parent=${parent}, asset=${asset}. ${GET_ASSET_VALID_COMBINATIONS}`,
        status: 0,
      },
    });
  },
};

export const catalogTools: ToolDef[] = [
  searchCatalog,
  getCatalogItem,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  uploadImage,
  getAsset,
];
