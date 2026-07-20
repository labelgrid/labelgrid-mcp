/**
 * `labelgrid asset delete` — delete a track asset file (stereo|dolby|lyrics)
 * or a release motion-artwork video (motion-square|motion-tall). Allowed only
 * while the parent release is an editable draft; the API refuses otherwise.
 * Destructive, so it prompts (bypass with --yes).
 */

import type { Command } from 'commander';
import { confirmOrAbort } from '../confirm.js';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { runApi } from '../run.js';

const TRACK_SLOTS: Record<string, string> = {
  stereo: 'stereo',
  dolby: 'dolby',
  lyrics: 'lyrics',
};
const RELEASE_SLOTS: Record<string, string> = {
  'motion-square': 'square',
  'motion-tall': 'tall',
};

export function registerAsset(program: Command, resolved: Resolved): void {
  const asset = program.command('asset').description('Track/release asset file management');

  asset
    .command('delete')
    .description('Delete a track asset (stereo|dolby|lyrics) or release motion artwork')
    .option('--track <id>', `the track id (types: ${Object.keys(TRACK_SLOTS).join('|')})`)
    .option('--release <id>', `the release id (types: ${Object.keys(RELEASE_SLOTS).join('|')})`)
    .requiredOption('--type <slot>', 'which asset slot to delete')
    .action(async (opts: { track?: string; release?: string; type: string }, cmd: Command) => {
      if ((opts.track === undefined) === (opts.release === undefined)) {
        cmd.error('Pass exactly one of --track <id> or --release <id>.');
      }
      let path: string;
      let what: string;
      if (opts.track !== undefined) {
        const slot = TRACK_SLOTS[opts.type];
        if (slot === undefined) {
          cmd.error(
            `Invalid --type "${opts.type}" for a track asset — expected one of: ${Object.keys(TRACK_SLOTS).join(', ')}.`,
          );
        }
        path = `/tracks/${encodeURIComponent(opts.track)}/files/${slot}`;
        what = `the ${opts.type} asset of track ${opts.track}`;
      } else {
        const slot = RELEASE_SLOTS[opts.type];
        if (slot === undefined) {
          cmd.error(
            `Invalid --type "${opts.type}" for a release asset — expected one of: ${Object.keys(RELEASE_SLOTS).join(', ')}.`,
          );
        }
        path = `/releases/${encodeURIComponent(opts.release as string)}/files/${slot}`;
        what = `the ${opts.type} asset of release ${opts.release}`;
      }
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await confirmOrAbort(ctx.out, `delete ${what}`, ctx.yes, ctx.readLine);
      await runApi(ctx, ctx.client.delete(path));
    });
}
