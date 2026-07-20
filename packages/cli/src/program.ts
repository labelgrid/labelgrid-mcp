/**
 * The commander program: global flags, every command group, and the exit-code
 * contract. `runCli` is the testable entry — it takes argv plus injectable
 * dependencies and RETURNS the exit code (0 success, 1 API/structured error,
 * 2 usage) instead of exiting, so unit tests drive the real wiring against a
 * stubbed core client with no live network.
 */

import { Command, CommanderError, Option } from 'commander';
import { registerAnalytics } from './commands/analytics.js';
import { registerAsset } from './commands/asset.js';
import { registerAuth } from './commands/auth.js';
import { registerCatalog, registerTrack } from './commands/catalog.js';
import { registerDownload } from './commands/download.js';
import { registerRoyalties, registerStatement, registerTransactions } from './commands/finance.js';
import { registerLicense } from './commands/license.js';
import { registerRelease } from './commands/release.js';
import { registerBeatport, registerReview } from './commands/review.js';
import { registerUpload } from './commands/upload.js';
import { registerWebhook } from './commands/webhook.js';
import type { CliDeps } from './context.js';
import { resolveDeps, resolveToken } from './context.js';
import { CliError, redactToken, scrubErrorMessage } from './errors.js';
import { VERSION } from './version.js';

export function buildProgram(deps: CliDeps = {}): Command {
  const resolved = resolveDeps(deps);
  // The token to redact from commander's own error output. Resolved lazily on
  // first error write (env + stored token) so the happy path stays store-read-free.
  let cached: { value: string | undefined } | undefined;
  const redactionToken = (): string | undefined => {
    if (cached === undefined) {
      cached = { value: resolveToken(resolved.env, resolved.tokenStore, undefined)?.token };
    }
    return cached.value;
  };
  const program = new Command('labelgrid');
  program
    .description('The official LabelGrid CLI')
    .version(VERSION)
    .option('--json', 'print the raw API response as JSON')
    .option('--token <token>', 'API token (lowest precedence: env > stored > --token)')
    .option('--api-url <url>', 'API base URL override')
    .option('--yes', 'skip confirmation prompts on destructive commands')
    .exitOverride()
    .configureOutput({
      writeOut: (s) => resolved.stdout.write(s),
      writeErr: (s) => resolved.stderr.write(redactToken(s, redactionToken())),
    });

  registerAuth(program, resolved);
  registerCatalog(program, resolved);
  registerRelease(program, resolved);
  registerTrack(program, resolved);
  registerUpload(program, resolved);
  registerDownload(program, resolved);
  registerAsset(program, resolved);
  registerLicense(program, resolved);
  registerStatement(program, resolved);
  registerTransactions(program, resolved);
  registerRoyalties(program, resolved);
  registerAnalytics(program, resolved);
  registerWebhook(program, resolved);
  registerReview(program, resolved);
  registerBeatport(program, resolved);

  // Commander does not inherit root options into subcommands, so an option
  // written AFTER the subcommand ("labelgrid auth whoami --json") would be
  // rejected. Register hidden copies of the global flags on every subcommand;
  // optsWithGlobals() then sees the flag wherever the user put it.
  addGlobalFlags(program);

  return program;
}

function addGlobalFlags(cmd: Command): void {
  for (const sub of cmd.commands) {
    for (const flags of [
      ['--json', 'print the raw API response as JSON'],
      ['--token <token>', 'API token (lowest precedence: env > stored > --token)'],
      ['--api-url <url>', 'API base URL override'],
      ['--yes', 'skip confirmation prompts on destructive commands'],
    ] as const) {
      sub.addOption(new Option(flags[0], flags[1]).hideHelp());
    }
    addGlobalFlags(sub as Command);
  }
}

/**
 * Parses and runs one invocation. `argv` is the user portion only (no node/
 * script prefix). Returns the process exit code.
 */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const resolved = resolveDeps(deps);
  const program = buildProgram(deps);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      return err.exitCode;
    }
    if (err instanceof CommanderError) {
      // Help/version display exits 0; every other commander error is usage (2).
      return err.exitCode === 0 ? 0 : 2;
    }
    const message = err instanceof Error ? err.message : 'Unexpected error.';
    const token = resolveToken(resolved.env, resolved.tokenStore, undefined)?.token;
    resolved.stderr.write(`UNEXPECTED_ERROR: ${scrubErrorMessage(message, token)}\n`);
    return 1;
  }
}
