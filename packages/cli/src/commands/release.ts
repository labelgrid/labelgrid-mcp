/**
 * `labelgrid release` — the release lifecycle actions: validate (safe,
 * repeatable), distribute and takedown (final, confirmed), confirm-review
 * (accept a Preflight-QC hold), landing-config (read the smart-link config)
 * and short-url (create/return the smart-link short URL).
 */

import type { Command } from 'commander';
import { confirmOrAbort } from '../confirm.js';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { runApi } from '../run.js';

export function registerRelease(program: Command, resolved: Resolved): void {
  const release = program
    .command('release')
    .description('Release lifecycle: validate, distribute, takedown, review, smart links');

  release
    .command('validate <id>')
    .description('Run the pre-distribution validation (changes nothing; safe to repeat)')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.post(`/releases/${encodeURIComponent(id)}/validate`));
    });

  release
    .command('distribute <id>')
    .description('Submit the release for distribution to the stores (FINAL action)')
    .option('--idempotency-key <key>', 'dedupe key — reuse the SAME key when retrying')
    .action(async (id: string, opts: { idempotencyKey?: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await confirmOrAbort(
        ctx.out,
        `distribute release ${id} to the stores`,
        ctx.yes,
        ctx.readLine,
      );
      await runApi(
        ctx,
        ctx.client.post(`/releases/${encodeURIComponent(id)}/distribute`, undefined, {
          idempotency: true,
          idempotencyKey: opts.idempotencyKey,
        }),
      );
    });

  release
    .command('takedown <id>')
    .description('Take the release down from ALL outlets/stores (FINAL action)')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await confirmOrAbort(
        ctx.out,
        `take release ${id} down from ALL outlets`,
        ctx.yes,
        ctx.readLine,
      );
      await runApi(ctx, ctx.client.post(`/releases/${encodeURIComponent(id)}/takedown-all`));
    });

  release
    .command('confirm-review <id>')
    .description('Confirm a Preflight-QC-held release into distribution review')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.post(`/releases/${encodeURIComponent(id)}/confirm-review`));
    });

  release
    .command('landing-config <id>')
    .description('Read the smart-link landing-page configuration')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get(`/releases/${encodeURIComponent(id)}/landing-config`));
    });

  release
    .command('short-url <id>')
    .description('Create (or return the existing) smart-link short URL')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.post('/releases/short-url', { release_id: Number(id) }));
    });
}
