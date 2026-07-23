/**
 * Minimal transfer-progress reporter for uploads and downloads. It writes a
 * single, in-place updating line to stderr (bytes transferred, and the total
 * when known), refreshed at most about twice a second, with a final newline.
 *
 * It is deliberately SILENT unless stderr is an interactive terminal AND the
 * run is not `--json` — a piped/redirected stream or a machine-readable run
 * gets no progress noise. This keeps scripts and tests (whose stderr is a plain
 * buffer, never a TTY) unaffected.
 */

import type { Output } from './output.js';

export type Progress = {
  /** Report the running byte count. */
  onProgress: (bytesSoFar: number) => void;
  /** Finish the line (prints the final count + a newline). Idempotent. */
  done: () => void;
};

const NO_OP: Progress = { onProgress: () => {}, done: () => {} };
const MIN_INTERVAL_MS = 500;

/** Builds a progress reporter, or a no-op when progress should stay silent. */
export function makeProgress(out: Output, total: number | undefined): Progress {
  const stream = out.stderr as { write(s: string): unknown; isTTY?: boolean };
  if (out.json || stream.isTTY !== true) return NO_OP;

  let lastRender = 0;
  let latest = 0;
  let finished = false;
  const render = (n: number, final: boolean): void => {
    const now = Date.now();
    if (!final && now - lastRender < MIN_INTERVAL_MS) return;
    lastRender = now;
    const totalPart = total !== undefined ? ` / ${total}` : '';
    out.stderr.write(`\r${n}${totalPart} bytes`);
  };
  return {
    onProgress: (bytesSoFar: number): void => {
      latest = bytesSoFar;
      render(bytesSoFar, false);
    },
    done: (): void => {
      if (finished) return;
      finished = true;
      render(latest, true);
      out.stderr.write('\n');
    },
  };
}
