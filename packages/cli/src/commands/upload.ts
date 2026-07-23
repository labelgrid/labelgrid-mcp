/**
 * `labelgrid upload` — finalized asset uploads via core's flows: track audio/
 * lyrics and release motion artwork go through the presigned-URL flow; cover
 * art is a multipart POST. Each type declares its extension allow-list (with
 * symlink resolution) so the CLI can never be pointed at an arbitrary file,
 * and the parent flag (--track vs --release) must match the type.
 */

import { statSync } from 'node:fs';
import { assertAllowedExtension, uploadViaPresignedUrl } from '@labelgrid/core';
import type { Command } from 'commander';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { makeProgress } from '../progress.js';
import { failWith, runApi } from '../run.js';

/** Byte size of a file, or undefined when it cannot be stat-ed. */
function fileSize(p: string): number | undefined {
  try {
    return statSync(p).size;
  } catch {
    return undefined;
  }
}

type UploadSpec =
  | { parent: 'track'; flow: 'presigned'; fileType: string; exts: string[] }
  | { parent: 'release'; flow: 'presigned'; assetType: string; exts: string[] }
  | { parent: 'release'; flow: 'multipart'; exts: string[] };

const UPLOAD_TYPES: Record<string, UploadSpec> = {
  stereo: {
    parent: 'track',
    flow: 'presigned',
    fileType: 'stereo',
    exts: ['.wav', '.flac', '.aif', '.aiff'],
  },
  dolby: { parent: 'track', flow: 'presigned', fileType: 'dolby', exts: ['.wav'] },
  lyrics: { parent: 'track', flow: 'presigned', fileType: 'lyrics', exts: ['.lrc', '.txt'] },
  'cover-art': {
    parent: 'release',
    flow: 'multipart',
    exts: ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'],
  },
  'motion-square': {
    parent: 'release',
    flow: 'presigned',
    assetType: 'square',
    exts: ['.mp4', '.mov'],
  },
  'motion-tall': {
    parent: 'release',
    flow: 'presigned',
    assetType: 'tall',
    exts: ['.mp4', '.mov'],
  },
};

export function registerUpload(program: Command, resolved: Resolved): void {
  program
    .command('upload <file>')
    .description('Upload a finalized track or release asset from a local file')
    .option('--track <id>', 'the track id (types stereo|dolby|lyrics)')
    .option('--release <id>', 'the release id (types cover-art|motion-square|motion-tall)')
    .requiredOption('--type <type>', `asset type: ${Object.keys(UPLOAD_TYPES).join('|')}`)
    .action(
      async (
        file: string,
        opts: { track?: string; release?: string; type: string },
        cmd: Command,
      ) => {
        const spec = UPLOAD_TYPES[opts.type];
        if (spec === undefined) {
          cmd.error(
            `Invalid --type "${opts.type}" — expected one of: ${Object.keys(UPLOAD_TYPES).join(', ')}.`,
          );
        }
        if ((opts.track === undefined) === (opts.release === undefined)) {
          cmd.error('Pass exactly one of --track <id> or --release <id>.');
        }
        if (spec.parent === 'track' && opts.track === undefined) {
          cmd.error(`--type ${opts.type} uploads a track asset — pass --track <id>.`);
        }
        if (spec.parent === 'release' && opts.release === undefined) {
          cmd.error(`--type ${opts.type} uploads a release asset — pass --release <id>.`);
        }
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        const ext = assertAllowedExtension(file, spec.exts);
        if ('error' in ext) failWith(ctx, ext.error);
        if (spec.parent === 'track') {
          const id = encodeURIComponent(opts.track as string);
          const progress = makeProgress(ctx.out, fileSize(ext.realPath));
          await runApi(
            ctx,
            uploadViaPresignedUrl(ctx.client, {
              uploadUrlPath: `/tracks/${id}/files/${spec.fileType}/upload-url`,
              commitPath: `/tracks/${id}/files/${spec.fileType}`,
              filePath: ext.realPath,
              onProgress: progress.onProgress,
            }).finally(() => progress.done()),
          );
          return;
        }
        const id = encodeURIComponent(opts.release as string);
        if (spec.flow === 'multipart') {
          // Cover art is small and goes through a single buffered multipart POST
          // (no byte-stream hook), so it shows no incremental progress.
          await runApi(
            ctx,
            ctx.client.postMultipart(`/releases/${id}/photo`, ext.realPath, 'file'),
          );
          return;
        }
        const progress = makeProgress(ctx.out, fileSize(ext.realPath));
        await runApi(
          ctx,
          uploadViaPresignedUrl(ctx.client, {
            uploadUrlPath: `/releases/${id}/files/${spec.assetType}/upload-url`,
            commitPath: `/releases/${id}/files/${spec.assetType}`,
            filePath: ext.realPath,
            onProgress: progress.onProgress,
          }).finally(() => progress.done()),
        );
      },
    );
}
