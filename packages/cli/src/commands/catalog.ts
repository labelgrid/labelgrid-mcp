/**
 * `labelgrid catalog` — entity CRUD across the six catalog kinds, selected
 * with `--type`. Thin over the entity registry in @labelgrid/core: search
 * lists with verbatim `--filter k=v` filters, create/update forward a
 * `--fields`/`--fields-file` JSON body, and the API owns all validation.
 * Release/track creates honor an idempotency key (auto-generated, or
 * `--idempotency-key` to dedupe a retried call).
 */

import { ENTITIES, ENTITY_NAMES, type EntityName } from '@labelgrid/core';
import type { Command } from 'commander';
import { confirmOrAbort } from '../confirm.js';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext } from '../context.js';
import { collectFilter, parseFields, parseFilters, runApi } from '../run.js';

const TYPE_DESC = `entity kind: ${ENTITY_NAMES.join('|')}`;

function entitySpec(cmd: Command, type: string): { name: EntityName; path: string } {
  if (!(ENTITY_NAMES as readonly string[]).includes(type)) {
    cmd.error(`Invalid --type "${type}" — expected one of: ${ENTITY_NAMES.join(', ')}.`);
  }
  const name = type as EntityName;
  return { name, path: ENTITIES[name].path };
}

export function registerCatalog(program: Command, resolved: Resolved): void {
  const catalog = program
    .command('catalog')
    .description('Catalog entities: labels, artists, writers, publishers, releases, tracks');

  catalog
    .command('search')
    .description('List entities of one kind, with the endpoint’s own filters')
    .requiredOption('--type <entity>', TYPE_DESC)
    .option('--filter <k=v>', 'filter (repeatable), passed through verbatim', collectFilter, [])
    .option('--page <n>', '1-based page number')
    .option('--per-page <n>', 'items per page')
    .action(
      async (
        opts: { type: string; filter: string[]; page?: string; perPage?: string },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        const { path } = entitySpec(cmd, opts.type);
        await runApi(
          ctx,
          ctx.client.get(path, {
            page: opts.page,
            per_page: opts.perPage,
            filter: parseFilters(cmd, opts.filter),
          }),
        );
      },
    );

  catalog
    .command('get <id>')
    .description('Retrieve one entity by id')
    .requiredOption('--type <entity>', TYPE_DESC)
    .action(async (id: string, opts: { type: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const { path } = entitySpec(cmd, opts.type);
      await runApi(ctx, ctx.client.get(`${path}/${encodeURIComponent(id)}`));
    });

  catalog
    .command('create')
    .description('Create an entity from a JSON fields payload')
    .requiredOption('--type <entity>', TYPE_DESC)
    .option('--fields <json>', 'the entity attributes as inline JSON')
    .option('--fields-file <path>', 'a JSON file with the entity attributes')
    .option('--idempotency-key <key>', 'dedupe key for retried release/track creates')
    .action(
      async (
        opts: { type: string; fields?: string; fieldsFile?: string; idempotencyKey?: string },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        const { name, path } = entitySpec(cmd, opts.type);
        const body = parseFields(cmd, opts.fields, opts.fieldsFile);
        // Only the release and track POST endpoints support idempotency keys.
        if (name === 'release' || name === 'track') {
          await runApi(
            ctx,
            ctx.client.post(path, body, {
              idempotency: true,
              idempotencyKey: opts.idempotencyKey,
            }),
          );
          return;
        }
        await runApi(ctx, ctx.client.post(path, body));
      },
    );

  catalog
    .command('update <id>')
    .description('Update an entity — supply only the fields to change')
    .requiredOption('--type <entity>', TYPE_DESC)
    .option('--fields <json>', 'the fields to change as inline JSON')
    .option('--fields-file <path>', 'a JSON file with the fields to change')
    .action(
      async (
        id: string,
        opts: { type: string; fields?: string; fieldsFile?: string },
        cmd: Command,
      ) => {
        const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
        const { path } = entitySpec(cmd, opts.type);
        const body = parseFields(cmd, opts.fields, opts.fieldsFile);
        await runApi(ctx, ctx.client.patch(`${path}/${encodeURIComponent(id)}`, body));
      },
    );

  catalog
    .command('delete <id>')
    .description('Delete an entity (the API refuses deletes that would orphan data)')
    .requiredOption('--type <entity>', TYPE_DESC)
    .action(async (id: string, opts: { type: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const { name, path } = entitySpec(cmd, opts.type);
      await confirmOrAbort(ctx.out, `delete ${name} ${id}`, ctx.yes, ctx.readLine);
      await runApi(ctx, ctx.client.delete(`${path}/${encodeURIComponent(id)}`));
    });
}

/** `labelgrid track` — alias guidance to the catalog group. */
export function registerTrack(program: Command, resolved: Resolved): void {
  program
    .command('track')
    .description('Track operations live under the catalog group (--type track)')
    .action(() => {
      resolved.stdout.write(
        'Tracks are catalog entities. Use:\n' +
          '  labelgrid catalog search --type track --filter release_id=<id>\n' +
          '  labelgrid catalog get <id> --type track\n' +
          '  labelgrid catalog create --type track --fields <json>\n' +
          '  labelgrid catalog update <id> --type track --fields <json>\n' +
          '  labelgrid catalog delete <id> --type track\n',
      );
    });
}
