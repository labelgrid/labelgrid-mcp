/**
 * `labelgrid review` — release review reads and issue notes:
 *   issues --release <id>          — the review issues raised against a release
 *   quality-report --release <id>  — the Preflight QC report ([--refresh] re-runs
 *                                    the checks first; the server budgets refreshes)
 *   note --issue <id> --text <t>   — attach a note to a review issue
 * Plus `labelgrid beatport enable --label <id>` — one-time Beatport onboarding.
 */

import type { Command } from 'commander';
import { confirmOrAbort } from '../confirm.js';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { failWith, runApi } from '../run.js';

export function registerReview(program: Command, resolved: Resolved): void {
  const review = program.command('review').description('Release review issues and QC reports');

  review
    .command('issues')
    .description('List the review issues raised against a release')
    .requiredOption('--release <id>', 'the release id')
    .action(async (opts: { release: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get('/review-issues', { release_id: opts.release }));
    });

  review
    .command('quality-report')
    .description('Retrieve the Preflight QC quality report for a release')
    .requiredOption('--release <id>', 'the release id')
    .option('--refresh', 're-run the QC checks before reading the report')
    .action(async (opts: { release: string; refresh?: boolean }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const release = encodeURIComponent(opts.release);
      if (opts.refresh === true) {
        const refreshed = await ctx.client.post(`/releases/${release}/quality-report/refresh`);
        if ('error' in refreshed) failWith(ctx, refreshed.error);
      }
      await runApi(ctx, ctx.client.get(`/releases/${release}/quality-report`));
    });

  review
    .command('note')
    .description('Attach a note to a review issue')
    .requiredOption('--issue <id>', 'the review issue id (from review issues)')
    .requiredOption('--text <note>', 'the note text')
    .action(async (opts: { issue: string; text: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(
        ctx,
        ctx.client.post(`/review-issues/${encodeURIComponent(opts.issue)}/notes`, {
          note: opts.text,
        }),
      );
    });
}

/** `labelgrid beatport enable --label <id>` — one-time Beatport onboarding. */
export function registerBeatport(program: Command, resolved: Resolved): void {
  const beatport = program.command('beatport').description('Beatport onboarding');

  beatport
    .command('enable')
    .description('Request Beatport onboarding for a label (one-time; cannot be un-requested)')
    .requiredOption('--label <id>', 'the label id')
    .action(async (opts: { label: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await confirmOrAbort(
        ctx.out,
        `request Beatport onboarding for label ${opts.label} (one-time, cannot be un-requested)`,
        ctx.yes,
        ctx.readLine,
      );
      await runApi(
        ctx,
        ctx.client.post(`/labels/${encodeURIComponent(opts.label)}/enable-beatport`),
      );
    });
}
