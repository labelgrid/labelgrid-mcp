/**
 * `labelgrid analytics get` — the streaming analytics summary. `--start`,
 * `--end` and `--metrics` are required (the server caps the window at 400 days
 * and accepts 1-12 section keys per request out of the 37 available).
 * `labelgrid analytics availability` — the static section-by-platform
 * availability matrix and per-platform reporting cadence.
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
    .requiredOption('--end <date>', 'window end, YYYY-MM-DD (max 400-day span)')
    .requiredOption('--metrics <list>', 'comma-separated section keys, 1-12 per request')
    .option(
      '--platform <name>',
      'SPOTIFY, ITUNES, APPLE_MUSIC, DEEZER, BOOMPLAY, AWA, AUDIOMACK, AMAZON, KUGOU, KUWO or QQMUSIC',
    )
    .option('--release-id <id>', 'narrow to one release')
    .option('--isrc <isrc>', 'narrow to one ISRC')
    .option('--upc <upc>', 'narrow to one UPC')
    .option('--limit <n>', 'per-section item limit')
    .action(
      async (
        opts: {
          start: string;
          end: string;
          metrics: string;
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

  analytics
    .command('availability')
    .description('Show the section-by-platform availability matrix and reporting cadence')
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get('/analytics/availability'));
    });
}
