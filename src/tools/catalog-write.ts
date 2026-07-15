/**
 * Catalog write toolset (safe writes): create/update/delete for labels,
 * artists, writers and publishers, plus multipart image uploads.
 *
 * Create/update forward a permissive `fields` object straight to the API, which
 * owns all validation — this keeps each tool a thin wrapper and lets the full
 * documented field set through without re-declaring it here. The tool
 * descriptions name the required and common fields; consult the LabelGrid API
 * docs for the complete list.
 */

import { statSync } from 'node:fs';
import { z } from 'zod';
import { assertAllowedExtension } from '../api/content-types.js';
import type { ApiError, ApiResult } from '../api/http.js';
import type { ToolContext, ToolDef } from './types.js';

/** Accepted image extensions for the catalog image uploads. */
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];

/** A permissive body of API fields, forwarded verbatim to the endpoint. */
function fieldsBody(desc: string): z.ZodType {
  return z.record(z.string(), z.unknown()).describe(desc);
}

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

function createTool(spec: {
  name: string;
  path: string;
  title: string;
  description: string;
  fieldsDesc: string;
}): ToolDef {
  return {
    name: spec.name,
    toolset: 'catalog',
    gate: 'safe_write',
    title: spec.title,
    description: spec.description,
    inputShape: { fields: fieldsBody(spec.fieldsDesc) },
    annotations: {},
    handler: (args, { client }) => client.post(spec.path, args.fields),
  };
}

function updateTool(spec: {
  name: string;
  idField: string;
  basePath: string;
  title: string;
  description: string;
  fieldsDesc: string;
}): ToolDef {
  return {
    name: spec.name,
    toolset: 'catalog',
    gate: 'safe_write',
    title: spec.title,
    description: spec.description,
    inputShape: {
      [spec.idField]: z.number().int().positive(),
      fields: fieldsBody(spec.fieldsDesc),
    },
    annotations: {},
    handler: (args, { client }) =>
      client.patch(`${spec.basePath}/${args[spec.idField]}`, args.fields),
  };
}

function deleteTool(spec: {
  name: string;
  idField: string;
  basePath: string;
  title: string;
  description: string;
}): ToolDef {
  return {
    name: spec.name,
    toolset: 'catalog',
    gate: 'safe_write',
    title: spec.title,
    description: spec.description,
    inputShape: { [spec.idField]: z.number().int().positive() },
    annotations: { destructiveHint: true },
    handler: (args, { client }) => client.delete(`${spec.basePath}/${args[spec.idField]}`),
  };
}

const uploadLabelImage: ToolDef = {
  name: 'upload_label_image',
  toolset: 'catalog',
  gate: 'safe_write',
  title: 'Upload a label image',
  description:
    'Upload a label image from a local file. `image_type` selects which asset: logo, logo-dark (a dark-mode variant), or background. `file_path` must be a local image file.',
  inputShape: {
    label_id: z.number().int().positive(),
    image_type: z.enum(['logo', 'logo-dark', 'background']),
    file_path: z.string().describe('Local path to the image file to upload.'),
  },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const err = fileError(args.file_path as string);
    if (err) return { error: err };
    const ext = assertAllowedExtension(args.file_path as string, IMAGE_EXTS);
    if ('error' in ext) return { error: ext.error };
    return client.postMultipart(
      `/labels/${args.label_id}/images/${args.image_type}`,
      ext.realPath,
      'file',
    );
  },
};

const uploadArtistPhoto: ToolDef = {
  name: 'upload_artist_photo',
  toolset: 'catalog',
  gate: 'safe_write',
  title: 'Upload an artist photo',
  description: 'Upload an artist photo from a local file. `file_path` must be a local image file.',
  inputShape: {
    artist_id: z.number().int().positive(),
    file_path: z.string().describe('Local path to the photo file to upload.'),
  },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const err = fileError(args.file_path as string);
    if (err) return { error: err };
    const ext = assertAllowedExtension(args.file_path as string, IMAGE_EXTS);
    if ('error' in ext) return { error: ext.error };
    return client.postMultipart(`/artists/${args.artist_id}/photo`, ext.realPath, 'file');
  },
};

export const catalogWriteTools: ToolDef[] = [
  createTool({
    name: 'create_label',
    path: '/labels',
    title: 'Create a label',
    description: 'Create a new label. Pass its attributes in `fields`.',
    fieldsDesc:
      'Label attributes. Required: name (string), default_email (string). Common optional: active, support_email, website_url, spotify_url, applemusic_url, default_copyright_name_p_line, default_copyright_name_c_line, isrc_base, enable_website, image. See the API docs for the full field list.',
  }),
  updateTool({
    name: 'update_label',
    idField: 'label_id',
    basePath: '/labels',
    title: 'Update a label',
    description: 'Update a label. Supply only the fields you want to change in `fields`.',
    fieldsDesc:
      'Label fields to change (same field set as create_label). Supply only what changes.',
  }),
  deleteTool({
    name: 'delete_label',
    idField: 'label_id',
    basePath: '/labels',
    title: 'Delete a label',
    description:
      'Delete a label. The API refuses to delete a label that still has releases — remove or reassign its releases first.',
  }),
  uploadLabelImage,
  createTool({
    name: 'create_artist',
    path: '/artists',
    title: 'Create an artist',
    description: 'Create a new artist. Pass its attributes in `fields`.',
    fieldsDesc:
      'Artist attributes. Required: artist_name (string). Common optional: full_name, email, location, bio_short, bio_full, isni, default_language, and platform profile URLs (spotify_url, applemusic_url, youtube_url, etc.). See the API docs for the full field list.',
  }),
  updateTool({
    name: 'update_artist',
    idField: 'artist_id',
    basePath: '/artists',
    title: 'Update an artist',
    description: 'Update an artist. Supply only the fields you want to change in `fields`.',
    fieldsDesc:
      'Artist fields to change (same field set as create_artist). Supply only what changes.',
  }),
  deleteTool({
    name: 'delete_artist',
    idField: 'artist_id',
    basePath: '/artists',
    title: 'Delete an artist',
    description:
      'Delete an artist. The API refuses deletion when the artist is still referenced by releases or tracks.',
  }),
  uploadArtistPhoto,
  createTool({
    name: 'create_writer',
    path: '/writers',
    title: 'Create a writer',
    description: 'Create a new songwriter. Pass its attributes in `fields`.',
    fieldsDesc:
      'Writer attributes. Required: first_name (string), last_name (string). Common optional: middle_name, display_credits, email, country, pro, ipi, isni, publisher_id (or publisher_name/publisher_pro/publisher_ipi). See the API docs for the full field list.',
  }),
  updateTool({
    name: 'update_writer',
    idField: 'writer_id',
    basePath: '/writers',
    title: 'Update a writer',
    description: 'Update a writer. Supply only the fields you want to change in `fields`.',
    fieldsDesc:
      'Writer fields to change (same field set as create_writer). Supply only what changes.',
  }),
  deleteTool({
    name: 'delete_writer',
    idField: 'writer_id',
    basePath: '/writers',
    title: 'Delete a writer',
    description:
      'Delete a writer. The API refuses deletion when the writer is still referenced by tracks.',
  }),
  createTool({
    name: 'create_publisher',
    path: '/publishers',
    title: 'Create a publisher',
    description: 'Create a new publisher. Pass its attributes in `fields`.',
    fieldsDesc:
      'Publisher attributes. Required: name (string). Common optional: ipi, pro, isni, controlled_publisher. See the API docs for the full field list.',
  }),
  updateTool({
    name: 'update_publisher',
    idField: 'publisher_id',
    basePath: '/publishers',
    title: 'Update a publisher',
    description: 'Update a publisher. Supply only the fields you want to change in `fields`.',
    fieldsDesc:
      'Publisher fields to change (same field set as create_publisher). Supply only what changes.',
  }),
  deleteTool({
    name: 'delete_publisher',
    idField: 'publisher_id',
    basePath: '/publishers',
    title: 'Delete a publisher',
    description:
      'Delete a publisher. The API refuses deletion when the publisher is still referenced by writers.',
  }),
];
