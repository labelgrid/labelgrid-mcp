import { describe, expect, it } from 'vitest';
import type { Output } from '../../src/output.js';
import { makeProgress } from '../../src/progress.js';

/** A stderr sink that records writes and can pretend to be a TTY. */
function ttyOut(opts: { isTTY: boolean; json?: boolean }): { out: Output; writes: string[] } {
  const writes: string[] = [];
  const stderr = {
    write(s: string): boolean {
      writes.push(s);
      return true;
    },
    isTTY: opts.isTTY,
  };
  const out: Output = {
    json: opts.json === true,
    stdout: { write: () => true },
    stderr: stderr as unknown as Output['stderr'],
    secrets: [],
  };
  return { out, writes };
}

describe('makeProgress', () => {
  it('renders an in-place line with total and a final newline on a TTY', () => {
    const { out, writes } = ttyOut({ isTTY: true });
    const p = makeProgress(out, 1000);
    p.onProgress(500);
    p.done();
    const text = writes.join('');
    expect(text).toContain('\r');
    expect(text).toContain('500 / 1000 bytes');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('omits the total when it is unknown', () => {
    const { out, writes } = ttyOut({ isTTY: true });
    const p = makeProgress(out, undefined);
    p.onProgress(42);
    p.done();
    expect(writes.join('')).toContain('42 bytes');
    expect(writes.join('')).not.toContain('/');
  });

  it('is silent when stderr is not a TTY', () => {
    const { out, writes } = ttyOut({ isTTY: false });
    const p = makeProgress(out, 1000);
    p.onProgress(500);
    p.done();
    expect(writes).toHaveLength(0);
  });

  it('is silent under --json even on a TTY', () => {
    const { out, writes } = ttyOut({ isTTY: true, json: true });
    const p = makeProgress(out, 1000);
    p.onProgress(500);
    p.done();
    expect(writes).toHaveLength(0);
  });

  it('throttles intermediate updates but always renders the final count', () => {
    const { out, writes } = ttyOut({ isTTY: true });
    const p = makeProgress(out, 1000);
    // Many rapid updates within the throttle window collapse to one render;
    // done() always renders the final value.
    for (let i = 1; i <= 50; i++) p.onProgress(i * 10);
    p.done();
    const text = writes.join('');
    // Fewer render lines than updates (throttled), and the final total is shown.
    expect(writes.length).toBeLessThan(50);
    expect(text).toContain('500 / 1000 bytes');
  });

  it('done() is idempotent', () => {
    const { out, writes } = ttyOut({ isTTY: true });
    const p = makeProgress(out, 1000);
    p.onProgress(10);
    p.done();
    const afterFirst = writes.length;
    p.done();
    expect(writes.length).toBe(afterFirst);
  });
});
