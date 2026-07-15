/**
 * Full-write toolset (`distribution`): the consequential actions that put a
 * release into the world or change immutable assets. Every tool here is gated
 * `full_write`, so it is neither registered nor callable unless the operator
 * has explicitly armed full writes (the flag AND the acknowledgment sentence).
 *
 * These wrap: finalized audio/artwork uploads (via the presigned-URL flow),
 * license file management, the FINAL distribute/takedown actions, the
 * Preflight-QC confirm-review step, and one-time Beatport onboarding.
 */

import { z } from 'zod';
import { assertAllowedExtension } from '../api/content-types.js';
import type { ApiResult } from '../api/http.js';
import { uploadViaPresignedUrl } from '../api/upload.js';
import type { ToolDef } from './types.js';

/** Per-tool upload extension allow-lists: an upload tool never reads an arbitrary file. */
const AUDIO_EXTS: Record<string, string[]> = {
  stereo: ['.wav', '.flac', '.aif', '.aiff'],
  dolby: ['.wav'],
  lyrics: ['.lrc', '.txt'],
};
const ANIMATED_COVER_EXTS = ['.mp4', '.mov'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];
const LICENSE_EXTS = ['.pdf', '.jpg', '.jpeg', '.png'];

const TRACK_FILE_TYPE = z
  .enum(['stereo', 'dolby', 'lyrics'])
  .describe('Which track asset: stereo audio, Dolby Atmos audio, or the lyrics (LRC) file.');

const RELEASE_ASSET_TYPE = z
  .enum(['square', 'tall'])
  .describe(
    'Which animated cover (motion artwork) video: the square or the tall/portrait cover video.',
  );

const trackId = z.number().int().positive().describe('The track id.');
const releaseId = z.number().int().positive().describe('The release id.');
const labelId = z.number().int().positive().describe('The label id.');
const filePath = z.string().describe('Local path to the file to upload.');

/** Optional caller-supplied idempotency key, plumbed to the Idempotency-Key header. */
const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .optional()
  .describe(
    'Optional idempotency key. The server deduplicates by this key for 24h — pass the SAME key when retrying a call whose outcome you did not observe. Without it, each call is a new operation.',
  );

/** Optional license metadata shared by the license upload/update tools. */
const licenseMeta = {
  license_id: z.string().optional().describe('The license/clearance reference number, if any.'),
  license_provider: z
    .enum(['licensing_agency', 'direct_from_publisher'])
    .optional()
    .describe('Where the license came from.'),
  license_provider_name: z.string().optional().describe('The name of the license provider.'),
  original_track_link: z.string().optional().describe('URL to the original/source track.'),
} as const;

/** Collects the defined license metadata fields into a string map for multipart. */
function licenseExtra(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [
    'type',
    'license_id',
    'license_provider',
    'license_provider_name',
    'original_track_link',
  ]) {
    const v = args[key];
    if (v !== undefined && v !== null) out[key] = String(v);
  }
  return out;
}

const uploadTrackAudio: ToolDef = {
  name: 'upload_track_audio',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Upload a track audio/lyrics file',
  description:
    'Upload a finalized audio file (stereo WAV/FLAC or Dolby Atmos) or lyrics (LRC) file for a track. The file is uploaded directly to storage and then processed asynchronously; check its state with get_track_file. Once a release is distributed the file is immutable — upload the correct master before distributing.',
  inputShape: { track_id: trackId, file_type: TRACK_FILE_TYPE, file_path: filePath },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const ext = assertAllowedExtension(
      args.file_path as string,
      AUDIO_EXTS[args.file_type as string],
    );
    if ('error' in ext) return { error: ext.error };
    return uploadViaPresignedUrl(client, {
      uploadUrlPath: `/tracks/${args.track_id}/files/${args.file_type}/upload-url`,
      commitPath: `/tracks/${args.track_id}/files/${args.file_type}`,
      filePath: ext.realPath,
    });
  },
};

const deleteTrackAudio: ToolDef = {
  name: 'delete_track_audio',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Delete a track audio/lyrics file',
  description:
    'Delete one of a track’s asset files (stereo, Dolby Atmos, or lyrics). Allowed only while the parent release is still an editable draft; the API refuses once the release is locked or distributed.',
  inputShape: { track_id: trackId, file_type: TRACK_FILE_TYPE },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.delete(`/tracks/${args.track_id}/files/${args.file_type}`),
};

const uploadReleaseAsset: ToolDef = {
  name: 'upload_release_asset',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Upload a release animated cover video',
  description:
    'Upload a finalized animated cover (motion artwork) video for a release — the square or the tall/portrait cover video. The video is uploaded directly to storage and then processed; check its state with get_release_file. Upload the correct video before distributing — it is immutable once the release is live. For the static cover art image use upload_release_artwork.',
  inputShape: { release_id: releaseId, asset_type: RELEASE_ASSET_TYPE, file_path: filePath },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const ext = assertAllowedExtension(args.file_path as string, ANIMATED_COVER_EXTS);
    if ('error' in ext) return { error: ext.error };
    return uploadViaPresignedUrl(client, {
      uploadUrlPath: `/releases/${args.release_id}/files/${args.asset_type}/upload-url`,
      commitPath: `/releases/${args.release_id}/files/${args.asset_type}`,
      filePath: ext.realPath,
    });
  },
};

const deleteReleaseAsset: ToolDef = {
  name: 'delete_release_asset',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Delete a release animated cover video',
  description:
    'Delete a release animated cover (motion artwork) video — the square or the tall/portrait cover video. Allowed only while the release is still an editable draft.',
  inputShape: { release_id: releaseId, asset_type: RELEASE_ASSET_TYPE },
  annotations: { destructiveHint: true },
  handler: (args, { client }) =>
    client.delete(`/releases/${args.release_id}/files/${args.asset_type}`),
};

const uploadReleaseArtwork: ToolDef = {
  name: 'upload_release_artwork',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Upload release cover art',
  description:
    'Upload or replace the release’s static cover art image from a local file. Cover art is immutable once the release is distributed — upload the final artwork before distributing.',
  inputShape: { release_id: releaseId, file_path: filePath },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const ext = assertAllowedExtension(args.file_path as string, IMAGE_EXTS);
    if ('error' in ext) return { error: ext.error };
    return client.postMultipart(`/releases/${args.release_id}/photo`, ext.realPath, 'file');
  },
};

const uploadTrackLicense: ToolDef = {
  name: 'upload_track_license',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Upload a track license',
  description:
    'Attach a license document to a track (for a cover or a cleared sample). `file_path` is the local license file and `type` is "cover" or "sample". Optionally record license_id, license_provider, license_provider_name, and original_track_link. Licenses are immutability-governed once the release is live.',
  inputShape: {
    track_id: trackId,
    file_path: filePath,
    type: z.enum(['cover', 'sample']).describe('The kind of license: a cover or a sample license.'),
    ...licenseMeta,
  },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const ext = assertAllowedExtension(args.file_path as string, LICENSE_EXTS);
    if ('error' in ext) return { error: ext.error };
    return client.postMultipart(
      `/tracks/${args.track_id}/licenses`,
      ext.realPath,
      'file',
      licenseExtra(args),
    );
  },
};

const updateTrackLicense: ToolDef = {
  name: 'update_track_license',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Update a track license',
  description:
    'Replace the file and/or metadata of an existing track license. `track_license_id` is the id of the license (from list_track_licenses); `file_path` is the license file to submit. Optionally update license_id, license_provider, license_provider_name, and original_track_link.',
  inputShape: {
    track_id: trackId,
    track_license_id: z.number().int().positive().describe('The track license id to update.'),
    file_path: filePath,
    ...licenseMeta,
  },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const ext = assertAllowedExtension(args.file_path as string, LICENSE_EXTS);
    if ('error' in ext) return { error: ext.error };
    return client.postMultipart(
      `/tracks/${args.track_id}/licenses/${args.track_license_id}`,
      ext.realPath,
      'file',
      licenseExtra(args),
    );
  },
};

const deleteTrackLicense: ToolDef = {
  name: 'delete_track_license',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Delete a track license',
  description:
    'Permanently delete a track license and its file. `track_license_id` is the license id (from list_track_licenses). This cannot be undone.',
  inputShape: {
    track_id: trackId,
    track_license_id: z.number().int().positive().describe('The track license id to delete.'),
  },
  annotations: { destructiveHint: true },
  handler: (args, { client }) =>
    client.delete(`/tracks/${args.track_id}/licenses/${args.track_license_id}`),
};

const distributeRelease: ToolDef = {
  name: 'distribute_release',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Distribute a release',
  description:
    'Submit a release for distribution to the stores/outlets — this is the FINAL, consequential action that sends the release out; validate_release should pass first. The server enforces your account’s weekly submission limit and returns a structured error if it is exceeded. Pass idempotency_key and reuse the SAME value if you retry a call whose outcome you did not observe — the server deduplicates by it for 24h; without a key each call is a new submission.',
  inputShape: { release_id: releaseId, idempotency_key: idempotencyKey },
  annotations: { destructiveHint: true },
  handler: (args, { client }) =>
    client.post(`/releases/${args.release_id}/distribute`, undefined, {
      idempotency: true,
      idempotencyKey: args.idempotency_key as string | undefined,
    }),
};

const takedownRelease: ToolDef = {
  name: 'takedown_release',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Take down a release',
  description:
    'Take a release down from ALL outlets/stores — a final, consequential action that removes it everywhere it was delivered. Re-distribution afterward is a fresh submission.',
  inputShape: { release_id: releaseId },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.post(`/releases/${args.release_id}/takedown-all`),
};

const confirmReview: ToolDef = {
  name: 'confirm_review',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Confirm a held release into review',
  description:
    'Confirm a release that Preflight QC placed on hold, moving it into distribution review. Use after you have reviewed the quality report and accept the release as-is. Safe to repeat.',
  inputShape: { release_id: releaseId },
  annotations: { idempotentHint: true },
  handler: (args, { client }) => client.post(`/releases/${args.release_id}/confirm-review`),
};

const enableBeatport: ToolDef = {
  name: 'enable_beatport',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Request Beatport onboarding for a label',
  description:
    'Request Beatport onboarding for a label. This is a one-time action that cannot be un-requested once submitted, so confirm the label is correct first.',
  inputShape: { label_id: labelId },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.post(`/labels/${args.label_id}/enable-beatport`),
};

export const fullWriteTools: ToolDef[] = [
  uploadTrackAudio,
  deleteTrackAudio,
  uploadReleaseAsset,
  deleteReleaseAsset,
  uploadReleaseArtwork,
  uploadTrackLicense,
  updateTrackLicense,
  deleteTrackLicense,
  distributeRelease,
  takedownRelease,
  confirmReview,
  enableBeatport,
];
