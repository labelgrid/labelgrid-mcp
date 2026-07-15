/**
 * Catalog file reads: track and release asset lookups, a signed audio
 * download URL, and track license reads. All read-only, in the `catalog`
 * toolset.
 */

import { z } from 'zod';
import type { ToolDef } from './types.js';

/** Track asset kinds the API exposes. */
const TRACK_FILE_TYPE = z
  .enum(['stereo', 'dolby', 'lyrics'])
  .describe('Which track asset: stereo audio, Dolby Atmos audio, or the lyrics file.');

/** Downloadable track audio asset kinds for the signed download-url endpoint. */
const TRACK_DOWNLOAD_ASSET_TYPE = z
  .enum(['audio_16', 'audio_24', 'audio_32', 'audio_preview_full', 'audio_preview_clip'])
  .describe(
    'Which downloadable asset: audio_16/audio_24/audio_32 = the WAV master at that bit depth; ' +
      'audio_preview_full/audio_preview_clip = the generated MP3 preview (full-length / clip).',
  );

/** Release animated cover (motion artwork) video kinds. */
const RELEASE_ASSET_TYPE = z
  .enum(['square', 'tall'])
  .describe(
    'Which animated cover (motion artwork) video: the square or the tall/portrait cover video.',
  );

const getTrackFile: ToolDef = {
  name: 'get_track_file',
  toolset: 'catalog',
  gate: 'read',
  title: 'Get a track file',
  description:
    'Retrieve metadata about one of a track’s asset files (its stereo audio, Dolby Atmos audio, or lyrics file), including its processing state. This returns file information, not the bytes — use get_track_audio_download_url for a downloadable link.',
  inputShape: { track_id: z.number().int().positive(), file_type: TRACK_FILE_TYPE },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/tracks/${args.track_id}/files/${args.file_type}`),
};

const getTrackAudioDownloadUrl: ToolDef = {
  name: 'get_track_audio_download_url',
  toolset: 'catalog',
  gate: 'read',
  title: 'Get a track audio download URL',
  description:
    'Return a time-limited, signed URL to download one of a track’s audio assets. `asset_type` selects the asset: audio_16, audio_24, and audio_32 are the WAV master at that bit depth; audio_preview_full and audio_preview_clip are the generated MP3 preview (full-length / clip). Returns { download_url, expires_in }; the URL expires roughly 10 minutes after it is issued, so request a fresh one when it lapses. Fetch the URL directly — do not send your API token to it.',
  inputShape: { track_id: z.number().int().positive(), asset_type: TRACK_DOWNLOAD_ASSET_TYPE },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) =>
    client.get(`/tracks/${args.track_id}/files/${args.asset_type}/download-url`),
};

const listTrackLicenses: ToolDef = {
  name: 'list_track_licenses',
  toolset: 'catalog',
  gate: 'read',
  title: 'List track licenses',
  description:
    'List the licenses attached to a track (e.g. cover/mechanical or sample clearances), paginated.',
  inputShape: {
    track_id: z.number().int().positive(),
    page: z.number().int().positive().optional(),
    per_page: z.number().int().positive().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) =>
    client.get(`/tracks/${args.track_id}/licenses`, {
      page: args.page,
      per_page: args.per_page,
    }),
};

const getTrackLicense: ToolDef = {
  name: 'get_track_license',
  toolset: 'catalog',
  gate: 'read',
  title: 'Get a track license',
  description: 'Retrieve one license attached to a track by its license id.',
  inputShape: {
    track_id: z.number().int().positive(),
    license_id: z.number().int().positive(),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/tracks/${args.track_id}/licenses/${args.license_id}`),
};

const getReleaseFile: ToolDef = {
  name: 'get_release_file',
  toolset: 'catalog',
  gate: 'read',
  title: 'Get a release file',
  description:
    'Retrieve metadata about a release animated cover (motion artwork) video asset — the square or the tall/portrait cover video — including its processing state.',
  inputShape: { release_id: z.number().int().positive(), asset_type: RELEASE_ASSET_TYPE },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) =>
    client.get(`/releases/${args.release_id}/files/${args.asset_type}`),
};

export const filesReadTools: ToolDef[] = [
  getTrackFile,
  getTrackAudioDownloadUrl,
  listTrackLicenses,
  getTrackLicense,
  getReleaseFile,
];
