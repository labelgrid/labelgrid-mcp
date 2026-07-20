/**
 * Destructive-command confirmation. A human at a terminal IS the
 * acknowledgment (unlike the MCP server's env-var arming), so destructive
 * commands prompt `Type y to confirm` and `--yes` bypasses the prompt for
 * scripting. Anything but y/yes aborts with exit code 1 before any API call.
 */

import { aborted } from './errors.js';
import type { Output } from './output.js';
import { scrubSecrets } from './output.js';

export async function confirmOrAbort(
  out: Output,
  action: string,
  yes: boolean,
  readLine: () => Promise<string>,
): Promise<void> {
  if (yes) return;
  out.stderr.write(scrubSecrets(`About to ${action}.\nType y to confirm: `, out.secrets));
  const answer = (await readLine()).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') return;
  out.stderr.write('Aborted.\n');
  throw aborted();
}
