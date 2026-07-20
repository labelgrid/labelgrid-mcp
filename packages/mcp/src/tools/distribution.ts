/**
 * Distribution toolset (full writes): the consequential actions that put a
 * release into the world or change immutable assets. Every tool here is gated
 * `full_write`, so it is neither registered nor callable unless the operator
 * has explicitly armed full writes (the flag AND the acknowledgment sentence).
 *
 * These wrap: finalized audio/artwork/motion-artwork uploads (via the
 * presigned-URL flow or multipart), license file management, the FINAL
 * distribute/takedown actions, the Preflight-QC confirm-review step, and
 * one-time Beatport onboarding.
 */

import { type ApiResult, assertAllowedExtension, uploadViaPresignedUrl } from '@labelgrid/core';
import { z } from 'zod';
import type { ToolDef } from './types.js';

/** Per-target upload extension allow-lists: an upload tool never reads an arbitrary file. */
const TRACK_UPLOAD_EXTS: Record<string, string[]> = {
  track_stereo: ['.wav', '.flac', '.aif', '.aiff'],
  track_dolby: ['.wav'],
  track_lyrics: ['.lrc', '.txt'],
};
const MOTION_EXTS = ['.mp4', '.mov'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];
const LICENSE_EXTS = ['.pdf', '.jpg', '.jpeg', '.png'];

/** target → the API's track fileType path segment. */
const TRACK_FILE_TYPES: Record<string, string> = {
  track_stereo: 'stereo',
  track_dolby: 'dolby',
  track_lyrics: 'lyrics',
};

/** target → the API's release motion-artwork assetType path segment. */
const MOTION_ASSET_TYPES: Record<string, string> = {
  release_motion_square: 'square',
  release_motion_tall: 'tall',
};

const releaseId = z.number().int().positive().describe('The release id.');

/** Optional caller-supplied idempotency key, plumbed to the Idempotency-Key header. */
const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .optional()
  .describe(
    'The server deduplicates by this key for 24h — reuse the SAME key when retrying a call whose outcome you did not observe.',
  );

/** Optional license metadata shared by the license upload/update actions. */
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

const uploadAsset: ToolDef = {
  name: 'upload_asset',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Upload a release/track asset',
  description:
    'Upload a finalized track or release asset from a local file. `id` is the track id for track_* targets, the release id for release_*. ' +
    '`track_stereo` (stereo audio, WAV/FLAC/AIFF), `track_dolby` (Dolby Atmos, WAV) and `track_lyrics` (LRC) upload directly to storage and process asynchronously — check state with get_asset (mode info). ' +
    "`release_cover_art` uploads or replaces the release's static cover art image. " +
    '`release_motion_square` / `release_motion_tall` upload the animated cover (motion artwork) video — square or tall/portrait — also processed asynchronously. ' +
    'ALL of these become immutable once the release is distributed — upload the final files before distributing.',
  inputShape: {
    target: z
      .enum([
        'track_stereo',
        'track_dolby',
        'track_lyrics',
        'release_cover_art',
        'release_motion_square',
        'release_motion_tall',
      ])
      .describe('Which asset to upload.'),
    id: z.number().int().positive().describe('The track id (track_*) or release id (release_*).'),
    file_path: z.string().describe('Local path to the file to upload.'),
  },
  annotations: {},
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const target = args.target as string;
    const filePath = args.file_path as string;
    if (target in TRACK_FILE_TYPES) {
      const ext = assertAllowedExtension(filePath, TRACK_UPLOAD_EXTS[target]);
      if ('error' in ext) return { error: ext.error };
      const fileType = TRACK_FILE_TYPES[target];
      return uploadViaPresignedUrl(client, {
        uploadUrlPath: `/tracks/${args.id}/files/${fileType}/upload-url`,
        commitPath: `/tracks/${args.id}/files/${fileType}`,
        filePath: ext.realPath,
      });
    }
    if (target === 'release_cover_art') {
      const ext = assertAllowedExtension(filePath, IMAGE_EXTS);
      if ('error' in ext) return { error: ext.error };
      return client.postMultipart(`/releases/${args.id}/photo`, ext.realPath, 'file');
    }
    const ext = assertAllowedExtension(filePath, MOTION_EXTS);
    if ('error' in ext) return { error: ext.error };
    const assetType = MOTION_ASSET_TYPES[target];
    return uploadViaPresignedUrl(client, {
      uploadUrlPath: `/releases/${args.id}/files/${assetType}/upload-url`,
      commitPath: `/releases/${args.id}/files/${assetType}`,
      filePath: ext.realPath,
    });
  },
};

const deleteAsset: ToolDef = {
  name: 'delete_asset',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Delete a release/track asset',
  description:
    'Delete a track or release asset file. track_stereo|track_dolby|track_lyrics delete a track asset; release_motion_square|release_motion_tall delete an animated cover (motion artwork) video. Allowed only while the parent release is still an editable draft; the API refuses once the release is locked or distributed. Cover art has no delete endpoint and cannot be deleted here.',
  inputShape: {
    target: z
      .enum([
        'track_stereo',
        'track_dolby',
        'track_lyrics',
        'release_motion_square',
        'release_motion_tall',
      ])
      .describe('Which asset to delete.'),
    id: z
      .number()
      .int()
      .positive()
      .describe('The track id (track_*) or release id (release_motion_*).'),
  },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => {
    const target = args.target as string;
    if (target in TRACK_FILE_TYPES) {
      return client.delete(`/tracks/${args.id}/files/${TRACK_FILE_TYPES[target]}`);
    }
    return client.delete(`/releases/${args.id}/files/${MOTION_ASSET_TYPES[target]}`);
  },
};

const manageTrackLicense: ToolDef = {
  name: 'manage_track_license',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Manage a track license',
  description:
    'Manage the license documents attached to a track (for a cover or a cleared sample). Pick ONE action with `action`: ' +
    "`upload` attaches a new license — `file_path` required, `type` ('cover' or 'sample') selects the kind; optionally record license_id, license_provider, license_provider_name, original_track_link. " +
    '`update` replaces the file and/or metadata of an existing license — `track_license_id` (from list_track_licenses) and `file_path` required. ' +
    '`delete` permanently deletes a license and its file — `track_license_id` required; cannot be undone. ' +
    'Licenses are immutability-governed once the release is live.',
  inputShape: {
    action: z.enum(['upload', 'update', 'delete']).describe('Which license action.'),
    track_id: z.number().int().positive().describe('The track id.'),
    track_license_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('From list_track_licenses. Required for update/delete.'),
    file_path: z
      .string()
      .optional()
      .describe('Local path to the license file. Required for upload/update.'),
    type: z.enum(['cover', 'sample']).optional().describe('Kind of license (upload).'),
    ...licenseMeta,
  },
  annotations: { destructiveHint: true },
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const action = args.action as string;
    if ((action === 'update' || action === 'delete') && args.track_license_id === undefined) {
      return {
        error: {
          code: 'INVALID_SELECTOR',
          message: `action '${action}' requires \`track_license_id\` — the license to act on (from list_track_licenses).`,
          status: 0,
        },
      };
    }
    if (action === 'delete') {
      return client.delete(`/tracks/${args.track_id}/licenses/${args.track_license_id}`);
    }
    if (args.file_path === undefined) {
      return {
        error: {
          code: 'INVALID_SELECTOR',
          message: `action '${action}' requires \`file_path\` — the local license file to submit.`,
          status: 0,
        },
      };
    }
    const ext = assertAllowedExtension(args.file_path as string, LICENSE_EXTS);
    if ('error' in ext) return { error: ext.error };
    const path =
      action === 'upload'
        ? `/tracks/${args.track_id}/licenses`
        : `/tracks/${args.track_id}/licenses/${args.track_license_id}`;
    return client.postMultipart(path, ext.realPath, 'file', licenseExtra(args));
  },
};

const distributeRelease: ToolDef = {
  name: 'distribute_release',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Distribute a release',
  description:
    'Submit a release for distribution to the stores/outlets — the FINAL, consequential action that sends the release out; run_release_checks (check validate) should pass first. The server enforces your account’s weekly submission limit and returns a structured error if exceeded. Pass idempotency_key and reuse the SAME value when retrying an unobserved call; without a key each call is a new submission.',
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
  annotations: { destructiveHint: true, idempotentHint: true },
  handler: (args, { client }) => client.post(`/releases/${args.release_id}/confirm-review`),
};

const enableBeatport: ToolDef = {
  name: 'enable_beatport',
  toolset: 'distribution',
  gate: 'full_write',
  title: 'Request Beatport onboarding for a label',
  description:
    'Request Beatport onboarding for a label. A one-time action that cannot be un-requested, so confirm the label is correct first.',
  inputShape: { label_id: z.number().int().positive().describe('The label id.') },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.post(`/labels/${args.label_id}/enable-beatport`),
};

export const distributionTools: ToolDef[] = [
  uploadAsset,
  deleteAsset,
  manageTrackLicense,
  distributeRelease,
  takedownRelease,
  confirmReview,
  enableBeatport,
];
