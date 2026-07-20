/**
 * `labelgrid webhook` — webhook subscriptions: list/get/logs reads,
 * create/update via `--fields` JSON, test, and the destructive delete and
 * rotate-secret (both prompt; --yes bypasses). The create response carries the
 * signing secret ONCE — the API returns it, the CLI prints the response as-is.
 */

import type { Command } from 'commander';
import { confirmOrAbort } from '../confirm.js';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { parseFields, runApi } from '../run.js';

export function registerWebhook(program: Command, resolved: Resolved): void {
  const webhook = program.command('webhook').description('Webhook subscriptions');

  webhook
    .command('list')
    .description('List the webhook subscriptions on your account')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get('/webhooks'));
    });

  webhook
    .command('get <id>')
    .description('Retrieve one webhook subscription')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get(`/webhooks/${encodeURIComponent(id)}`));
    });

  webhook
    .command('create')
    .description('Create a subscription (fields: name, url, events)')
    .option('--fields <json>', 'the webhook attributes as inline JSON')
    .option('--fields-file <path>', 'a JSON file with the webhook attributes')
    .action(async (opts: { fields?: string; fieldsFile?: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const body = parseFields(cmd, opts.fields, opts.fieldsFile);
      await runApi(ctx, ctx.client.post('/webhooks', body));
    });

  webhook
    .command('update <id>')
    .description('Update a subscription (name, url, events, is_active)')
    .option('--fields <json>', 'the fields to change as inline JSON')
    .option('--fields-file <path>', 'a JSON file with the fields to change')
    .action(async (id: string, opts: { fields?: string; fieldsFile?: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const body = parseFields(cmd, opts.fields, opts.fieldsFile);
      await runApi(ctx, ctx.client.patch(`/webhooks/${encodeURIComponent(id)}`, body));
    });

  webhook
    .command('delete <id>')
    .description('Permanently remove a subscription (it stops receiving events)')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await confirmOrAbort(ctx.out, `delete webhook ${id}`, ctx.yes, ctx.readLine);
      await runApi(ctx, ctx.client.delete(`/webhooks/${encodeURIComponent(id)}`));
    });

  webhook
    .command('test <id>')
    .description('Send a test event to the subscription endpoint')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.post(`/webhooks/${encodeURIComponent(id)}/test`));
    });

  webhook
    .command('rotate-secret <id>')
    .description('Generate a new signing secret (the old one stops working immediately)')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await confirmOrAbort(
        ctx.out,
        `rotate the signing secret of webhook ${id} (the old secret stops working immediately)`,
        ctx.yes,
        ctx.readLine,
      );
      await runApi(ctx, ctx.client.post(`/webhooks/${encodeURIComponent(id)}/regenerate-secret`));
    });

  webhook
    .command('logs <id>')
    .description('Read the recent delivery log for a webhook')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get(`/webhooks/${encodeURIComponent(id)}/logs`));
    });
}
