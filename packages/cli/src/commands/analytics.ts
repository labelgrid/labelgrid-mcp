/**
 * `labelgrid analytics get` — the streaming analytics summary. `--start` and
 * `--end` are required (the server caps the window at 30 days); `--metrics`
 * narrows to a comma-separated subset of the 15 metric sections.
 */

import type { Command } from 'commander';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { commaList, runApi } from '../run.js';

export function registerAnalytics(program: Command, resolved: Resolved): void {
  const analytics = program.command('analytics').description('Streaming analytics');

  analytics
    .command('get')
    .description('Retrieve a streaming analytics summary for a date window')
    .requiredOption('--start <date>', 'window start, YYYY-MM-DD')
    .requiredOption('--end <date>', 'window end, YYYY-MM-DD (max 30-day span)')
    .option('--metrics <list>', 'comma-separated metric sections (omit for all 15)')
    .option('--platform <name>', 'SPOTIFY, ITUNES or APPLE_MUSIC')
    .option('--release-id <id>', 'narrow to one release')
    .option('--isrc <isrc>', 'narrow to one ISRC')
    .option('--upc <upc>', 'narrow to one UPC')
    .option('--limit <n>', 'per-section item limit')
    .action(
      async (
        opts: {
          start: string;
          end: string;
          metrics?: string;
          platform?: string;
          releaseId?: string;
          isrc?: string;
          upc?: string;
          limit?: string;
        },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        await runApi(
          ctx,
          ctx.client.get('/analytics/summary', {
            filter: {
              start_date: opts.start,
              end_date: opts.end,
              platform: opts.platform,
              release_id: opts.releaseId,
              isrc: opts.isrc,
              upc: opts.upc,
            },
            metrics: commaList(opts.metrics),
            limit: opts.limit,
          }),
        );
      },
    );
}
