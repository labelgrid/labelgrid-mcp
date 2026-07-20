/**
 * The financial read groups:
 *   `labelgrid statement list|get <invoice>` — royalty statements
 *   `labelgrid transactions list` — account transactions
 *   `labelgrid royalties breakdown|artificial-streams|artificial-fee` —
 *     royalty aggregation and artificial-streaming data
 * All thin GETs; `--filter k=v` pairs pass through verbatim and the API owns
 * validation. Statement files download via `labelgrid download --statement`.
 */

import type { Command } from 'commander';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { collectFilter, parseFilters, runApi } from '../run.js';

export function registerStatement(program: Command, resolved: Resolved): void {
  const statement = program.command('statement').description('Royalty statements');

  statement
    .command('list')
    .description('List your royalty statements')
    .option(
      '--filter <k=v>',
      'filter (repeatable): label_id, release_id, isrc, upc, start_date, end_date',
      collectFilter,
      [],
    )
    .option('--group-by <expr>', '"release" rolls totals up per release')
    .option('--page <n>', '1-based page number')
    .option('--per-page <n>', 'items per page')
    .action(
      async (
        opts: { filter: string[]; groupBy?: string; page?: string; perPage?: string },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        await runApi(
          ctx,
          ctx.client.get('/statements', {
            group_by: opts.groupBy,
            page: opts.page,
            per_page: opts.perPage,
            filter: parseFilters(cmd, opts.filter),
          }),
        );
      },
    );

  statement
    .command('get <invoice>')
    .description('Retrieve one statement by invoice number')
    .action(async (invoice: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get(`/statements/${encodeURIComponent(invoice)}`));
    });
}

export function registerTransactions(program: Command, resolved: Resolved): void {
  const transactions = program.command('transactions').description('Account transactions');

  transactions
    .command('list')
    .description('List account transactions')
    .option(
      '--filter <k=v>',
      'filter (repeatable): label_id, release_id, isrc, upc, start_date, end_date',
      collectFilter,
      [],
    )
    .option('--group-by <expr>', '"release" rolls totals up per release')
    .option('--sort <expr>', 'sort expression')
    .option('--page <n>', '1-based page number')
    .option('--per-page <n>', 'items per page')
    .action(
      async (
        opts: {
          filter: string[];
          groupBy?: string;
          sort?: string;
          page?: string;
          perPage?: string;
        },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        await runApi(
          ctx,
          ctx.client.get('/transactions', {
            group_by: opts.groupBy,
            sort: opts.sort,
            page: opts.page,
            per_page: opts.perPage,
            filter: parseFilters(cmd, opts.filter),
          }),
        );
      },
    );
}

export function registerRoyalties(program: Command, resolved: Resolved): void {
  const royalties = program
    .command('royalties')
    .description('Royalty breakdowns and artificial-streaming data');

  royalties
    .command('breakdown')
    .description('Cursor-paginated royalty breakdown (requires --group-by)')
    .option('--group-by <list>', 'ordered subset of: track, dsp, release, territory, period')
    .option(
      '--filter <k=v>',
      'filter (repeatable): label_id, release_id, isrc, upc, start_date, end_date',
      collectFilter,
      [],
    )
    .option('--cursor <cursor>', 'pagination cursor')
    .option('--per-page <n>', 'items per page')
    .action(
      async (
        opts: { groupBy?: string; filter: string[]; cursor?: string; perPage?: string },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        await runApi(
          ctx,
          ctx.client.get('/royalties/breakdown', {
            group_by: opts.groupBy,
            per_page: opts.perPage,
            cursor: opts.cursor,
            filter: parseFilters(cmd, opts.filter),
          }),
        );
      },
    );

  royalties
    .command('artificial-streams')
    .description('List the artificial-streaming records reported for your catalog')
    .option(
      '--filter <k=v>',
      'filter (repeatable): dsp, start_date, end_date, release_id, isrc',
      collectFilter,
      [],
    )
    .option('--cursor <cursor>', 'pagination cursor')
    .option('--per-page <n>', 'items per page')
    .action(async (opts: { filter: string[]; cursor?: string; perPage?: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      // This endpoint takes its filters as top-level query params.
      await runApi(
        ctx,
        ctx.client.get('/royalties/artificial-streams', {
          ...(parseFilters(cmd, opts.filter) ?? {}),
          cursor: opts.cursor,
          per_page: opts.perPage,
        }),
      );
    });

  royalties
    .command('artificial-fee')
    .description('Per-release breakdown of an artificial-streaming fee for one period')
    .requiredOption('--period <YYYY-MM>', 'the billing month')
    .action(async (opts: { period: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(
        ctx,
        ctx.client.get(`/artificial-streaming-fee/${encodeURIComponent(opts.period)}`),
      );
    });
}
