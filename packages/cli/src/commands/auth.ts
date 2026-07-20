/**
 * `labelgrid auth` — login (store a token), logout (clear it), whoami
 * (GET /me), and token-revoke (DELETE /tokens/current or /tokens/{id}).
 *
 * login/logout are purely local: they manage the stored credential and never
 * touch the network. whoami is the verification step. A token value is never
 * echoed anywhere.
 */

import type { Command } from 'commander';
import { confirmOrAbort } from '../confirm.js';
import type { GlobalOpts, Resolved } from '../context.js';
import { buildContext, buildOutput } from '../context.js';
import { CliError, scrubErrorMessage } from '../errors.js';
import { printApiError, printLine } from '../output.js';
import { runApi } from '../run.js';

async function readTokenInput(resolved: Resolved): Promise<string> {
  if (resolved.stdinIsTTY) {
    // Interactive terminal: read with echo disabled so the pasted token never
    // appears on screen. The reader writes nothing; we print the prompt and,
    // after entry, the newline the muted Enter key does not produce.
    resolved.stderr.write('Paste your API token (input hidden): ');
    try {
      return (await resolved.readSecret()).trim();
    } finally {
      resolved.stderr.write('\n');
    }
  }
  // Piped / non-TTY stdin: read one line, unchanged.
  resolved.stderr.write('Paste your API token (or pipe it via stdin): ');
  return (await resolved.readLine()).trim();
}

export function registerAuth(program: Command, resolved: Resolved): void {
  const auth = program.command('auth').description('Authentication and token management');

  auth
    .command('login')
    .description('Store an API token (macOS Keychain, or a 0600 credentials file elsewhere)')
    .action(async (_opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOpts>();
      let token: string;
      try {
        token = globals.token ?? (await readTokenInput(resolved));
      } catch (err) {
        // Hidden-input read failed/aborted — surface a scrubbed one-liner.
        const message = err instanceof Error ? err.message : 'Token entry failed.';
        resolved.stderr.write(`UNEXPECTED_ERROR: ${scrubErrorMessage(message, globals.token)}\n`);
        throw new CliError(1);
      }
      const out = buildOutput(resolved, globals, [token]);
      if (token.length === 0) {
        printApiError(out, {
          code: 'NO_TOKEN',
          message: 'No token provided. Pass --token <token> or pipe the token via stdin.',
          status: 0,
        });
        throw new CliError(1);
      }
      let where: string;
      try {
        where = resolved.tokenStore.save(token);
      } catch (err) {
        // Never let a storage error echo the token; scrub with it in context.
        const message = err instanceof Error ? err.message : 'Token storage failed.';
        resolved.stderr.write(`UNEXPECTED_ERROR: ${scrubErrorMessage(message, token)}\n`);
        throw new CliError(1);
      }
      printLine(out, `Token stored in ${where}. Run \`labelgrid auth whoami\` to verify.`);
    });

  auth
    .command('logout')
    .description('Remove the stored API token')
    .action((_opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOpts>();
      const out = buildOutput(resolved, globals, []);
      const cleared = resolved.tokenStore.clear();
      printLine(
        out,
        cleared
          ? `Removed the stored token from ${resolved.tokenStore.describe()}.`
          : `No stored token found in ${resolved.tokenStore.describe()}.`,
      );
    });

  auth
    .command('whoami')
    .description('Show the account the resolved API token belongs to')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      await runApi(ctx, ctx.client.get('/me'));
    });

  auth
    .command('token-revoke')
    .description('Revoke an API token (the current one when --token-id is omitted)')
    .option('--token-id <id>', 'revoke this token id instead of the token in use')
    .action(async (opts: { tokenId?: string }, cmd: Command) => {
      const ctx = buildContext(resolved, cmd.optsWithGlobals<GlobalOpts>());
      const target =
        opts.tokenId === undefined ? 'the token currently in use' : `token ${opts.tokenId}`;
      await confirmOrAbort(ctx.out, `revoke ${target}`, ctx.yes, ctx.readLine);
      const path =
        opts.tokenId === undefined
          ? '/tokens/current'
          : `/tokens/${encodeURIComponent(opts.tokenId)}`;
      await runApi(ctx, ctx.client.delete(path));
    });
}
