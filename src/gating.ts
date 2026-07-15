/**
 * Fail-closed tool gating.
 *
 * A tool is enabled only when its toolset is selected AND its gate's write
 * class is armed. Anything the matrix cannot positively resolve — including an
 * unrecognized gate — is disabled.
 */

import type { Config } from './config.js';

export type Gate = 'read' | 'safe_write' | 'full_write';

export function isToolEnabled(t: { gate: Gate; toolset: string }, c: Config): boolean {
  const toolsetSelected = c.toolsets === null || c.toolsets.has(t.toolset);
  if (!toolsetSelected) return false;

  switch (t.gate) {
    case 'read':
      return true;
    case 'safe_write':
      return c.writes;
    case 'full_write':
      return c.fullWrites;
    default:
      return false;
  }
}
