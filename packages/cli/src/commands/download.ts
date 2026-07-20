/**
 * `labelgrid download` — two modes:
 *   --track <id> --type audio_16|audio_24|audio_32|preview_full|preview_clip:
 *     asks the API for a signed download URL, then fetches the bytes from it
 *     directly (the signed URL is the credential — no auth header is sent).
 *   --statement <invoice> --type csv|invoice: an authenticated raw GET of the
 *     statement line items (CSV) or the invoice PDF.
 * Both write to --out with the wx-exclusive/absolute-path discipline
 * (overwrite requires --force).
 */

import type { Command } from 'commander';
import type { CommandContext, GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { validateOutPath, writeDownload } from '../downloads.js';
import { printData } from '../output.js';
import { authedRawGet, failWith, runApi } from '../run.js';

/** CLI track asset names → the API asset path segment. */
const TRACK_ASSETS: Record<string, string> = {
  audio_16: 'audio_16',
  audio_24: 'audio_24',
  audio_32: 'audio_32',
  preview_full: 'audio_preview_full',
  preview_clip: 'audio_preview_clip',
};

const STATEMENT_TYPES = new Set(['csv', 'invoice']);

async function downloadTrackAsset(
  ctx: CommandContext,
  trackId: string,
  asset: string,
  outPath: string,
  force: boolean,
): Promise<void> {
  const minted = await ctx.client.get<{ download_url?: unknown }>(
    `/tracks/${encodeURIComponent(trackId)}/files/${asset}/download-url`,
  );
  if ('error' in minted) {
    await runApi(ctx, Promise.resolve(minted)); // prints the error + throws
    return;
  }
  const url = minted.data?.download_url;
  if (typeof url !== 'string') {
    failWith(ctx, {
      code: 'DOWNLOAD_URL_INVALID',
      message: 'The download-url response did not contain a usable download_url.',
      status: 0,
    });
  }
  // The signed URL is the credential; fetch it directly with no auth header.
  let res: Response;
  try {
    res = await ctx.client.raw(url, { method: 'GET' });
  } catch (err) {
    failWith(ctx, {
      code: 'NETWORK_ERROR',
      message:
        err instanceof Error
          ? err.message.replace(/https?:\/\/\S+/gi, '[url]')
          : 'Network request failed.',
      status: 0,
    });
  }
  if (!res.ok) {
    failWith(ctx, {
      code: 'DOWNLOAD_FAILED',
      message: `Fetching the file from storage failed with status ${res.status}.`,
      status: res.status,
    });
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const writeErr = writeDownload(outPath, bytes, force);
  if (writeErr) failWith(ctx, writeErr);
  printData(ctx.out, { saved_to: outPath, bytes: bytes.length });
}

async function downloadStatementFile(
  ctx: CommandContext,
  invoice: string,
  type: string,
  outPath: string,
  force: boolean,
): Promise<void> {
  const path =
    type === 'csv'
      ? `/statements/${encodeURIComponent(invoice)}/csv`
      : `/statements/${encodeURIComponent(invoice)}/invoice`;
  const result = await authedRawGet(ctx, path);
  if (!result.ok) failWith(ctx, result.error);
  const bytes = Buffer.from(await result.res.arrayBuffer());
  const writeErr = writeDownload(outPath, bytes, force);
  if (writeErr) failWith(ctx, writeErr);
  printData(ctx.out, { saved_to: outPath, bytes: bytes.length });
}

export function registerDownload(program: Command, resolved: Resolved): void {
  program
    .command('download')
    .description('Download a track audio asset or a statement file to a local path')
    .option('--track <id>', `track download (types: ${Object.keys(TRACK_ASSETS).join('|')})`)
    .option('--statement <invoice>', 'statement download (types: csv|invoice)')
    .requiredOption('--type <type>', 'what to download (depends on --track vs --statement)')
    .requiredOption('--out <path>', 'absolute path to write the file to')
    .option('--force', 'overwrite an existing file at --out')
    .action(
      async (
        opts: { track?: string; statement?: string; type: string; out: string; force?: boolean },
        cmd: Command,
      ) => {
        if ((opts.track === undefined) === (opts.statement === undefined)) {
          cmd.error('Pass exactly one of --track <id> or --statement <invoice>.');
        }
        if (opts.track !== undefined && TRACK_ASSETS[opts.type] === undefined) {
          cmd.error(
            `Invalid --type "${opts.type}" for a track download — expected one of: ${Object.keys(TRACK_ASSETS).join(', ')}.`,
          );
        }
        if (opts.statement !== undefined && !STATEMENT_TYPES.has(opts.type)) {
          cmd.error(
            `Invalid --type "${opts.type}" for a statement download — expected csv or invoice.`,
          );
        }
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        const pathErr = validateOutPath(opts.out);
        if (pathErr) failWith(ctx, pathErr);
        const force = opts.force === true;
        if (opts.track !== undefined) {
          await downloadTrackAsset(ctx, opts.track, TRACK_ASSETS[opts.type], opts.out, force);
          return;
        }
        await downloadStatementFile(ctx, opts.statement as string, opts.type, opts.out, force);
      },
    );
}
