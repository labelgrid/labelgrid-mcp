/**
 * `labelgrid license` — track license documents (cover/sample clearances):
 * list, add (multipart upload), update (replace file/metadata) and delete.
 * Files are guarded by the license extension allow-list before any read or
 * HTTP call. Delete is destructive and prompts (bypass with --yes).
 */

import { assertAllowedExtension } from '@labelgrid/core';
import type { Command } from 'commander';
import { confirmOrAbort } from '../confirm.js';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { failWith, runApi } from '../run.js';

const LICENSE_EXTS = ['.pdf', '.jpg', '.jpeg', '.png'];

type LicenseMetaOpts = {
  licenseId?: string;
  provider?: string;
  providerName?: string;
  originalLink?: string;
};

function licenseExtra(type: string | undefined, opts: LicenseMetaOpts): Record<string, string> {
  const out: Record<string, string> = {};
  if (type !== undefined) out.type = type;
  if (opts.licenseId !== undefined) out.license_id = opts.licenseId;
  if (opts.provider !== undefined) out.license_provider = opts.provider;
  if (opts.providerName !== undefined) out.license_provider_name = opts.providerName;
  if (opts.originalLink !== undefined) out.original_track_link = opts.originalLink;
  return out;
}

/** The shared metadata flags for add/update. */
function withMetaOptions(cmd: Command): Command {
  return cmd
    .option('--license-id <ref>', 'the license/clearance reference number')
    .option('--provider <kind>', 'licensing_agency or direct_from_publisher')
    .option('--provider-name <name>', 'the license provider name')
    .option('--original-link <url>', 'URL to the original/source track');
}

export function registerLicense(program: Command, resolved: Resolved): void {
  const license = program
    .command('license')
    .description('Track license documents (cover/sample clearances)');

  license
    .command('list')
    .description('List the licenses attached to a track (or one by --id)')
    .requiredOption('--track <id>', 'the track id')
    .option('--id <trackLicenseId>', 'retrieve one license by id instead of listing')
    .option('--page <n>', '1-based page number')
    .option('--per-page <n>', 'items per page')
    .action(
      async (
        opts: { track: string; id?: string; page?: string; perPage?: string },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        const track = encodeURIComponent(opts.track);
        if (opts.id !== undefined) {
          await runApi(
            ctx,
            ctx.client.get(`/tracks/${track}/licenses/${encodeURIComponent(opts.id)}`),
          );
          return;
        }
        await runApi(
          ctx,
          ctx.client.get(`/tracks/${track}/licenses`, {
            page: opts.page,
            per_page: opts.perPage,
          }),
        );
      },
    );

  withMetaOptions(
    license
      .command('add')
      .description('Attach a new license document to a track')
      .requiredOption('--track <id>', 'the track id')
      .requiredOption('--file <path>', 'the local license file (.pdf/.jpg/.jpeg/.png)')
      .option('--type <kind>', 'the license kind: cover or sample'),
  ).action(
    async (
      opts: { track: string; file: string; type?: string } & LicenseMetaOpts,
      cmd: Command,
    ) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const ext = assertAllowedExtension(opts.file, LICENSE_EXTS);
      if ('error' in ext) failWith(ctx, ext.error);
      await runApi(
        ctx,
        ctx.client.postMultipart(
          `/tracks/${encodeURIComponent(opts.track)}/licenses`,
          ext.realPath,
          'file',
          licenseExtra(opts.type, opts),
        ),
      );
    },
  );

  withMetaOptions(
    license
      .command('update')
      .description('Replace the file and/or metadata of an existing license')
      .requiredOption('--track <id>', 'the track id')
      .requiredOption('--id <trackLicenseId>', 'the license to update (from license list)')
      .requiredOption('--file <path>', 'the replacement license file'),
  ).action(
    async (opts: { track: string; id: string; file: string } & LicenseMetaOpts, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const ext = assertAllowedExtension(opts.file, LICENSE_EXTS);
      if ('error' in ext) failWith(ctx, ext.error);
      await runApi(
        ctx,
        ctx.client.postMultipart(
          `/tracks/${encodeURIComponent(opts.track)}/licenses/${encodeURIComponent(opts.id)}`,
          ext.realPath,
          'file',
          licenseExtra(undefined, opts),
        ),
      );
    },
  );

  license
    .command('delete')
    .description('Permanently delete a license and its file (cannot be undone)')
    .requiredOption('--track <id>', 'the track id')
    .requiredOption('--id <trackLicenseId>', 'the license to delete (from license list)')
    .action(async (opts: { track: string; id: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await confirmOrAbort(
        ctx.out,
        `permanently delete license ${opts.id} of track ${opts.track}`,
        ctx.yes,
        ctx.readLine,
      );
      await runApi(
        ctx,
        ctx.client.delete(
          `/tracks/${encodeURIComponent(opts.track)}/licenses/${encodeURIComponent(opts.id)}`,
        ),
      );
    });
}
