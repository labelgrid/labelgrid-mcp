import { describe, expect, it } from 'vitest';
import { type RawModeStdin, readHiddenLine } from '../../src/secret-input.js';

type FakeStdin = RawModeStdin & {
  emit(s: string): void;
  events: { rawModes: boolean[]; resumed: number; paused: number; writes: string[] };
};

function fakeStdin(): FakeStdin {
  const listeners: ((chunk: Buffer) => void)[] = [];
  const events = { rawModes: [] as boolean[], resumed: 0, paused: 0, writes: [] as string[] };
  const stdin: FakeStdin = {
    setRawMode(mode: boolean): void {
      events.rawModes.push(mode);
    },
    on(_event: 'data', listener: (chunk: Buffer) => void): unknown {
      listeners.push(listener);
      return stdin;
    },
    removeListener(_event: 'data', listener: (chunk: Buffer) => void): unknown {
      const i = listeners.indexOf(listener);
      if (i >= 0) listeners.splice(i, 1);
      return stdin;
    },
    resume(): unknown {
      events.resumed += 1;
      return stdin;
    },
    pause(): unknown {
      events.paused += 1;
      return stdin;
    },
    emit(s: string): void {
      for (const listener of [...listeners]) listener(Buffer.from(s, 'utf8'));
    },
    events,
  };
  return stdin;
}

describe('readHiddenLine (hidden token entry)', () => {
  it('engages the echo-mute (raw mode), never echoes, and returns the typed line', async () => {
    const stdin = fakeStdin();
    const pending = readHiddenLine(stdin);
    stdin.emit('sekret-tok');
    stdin.emit('\r');
    const value = await pending;
    expect(value).toBe('sekret-tok');
    // Echo-mute wiring engaged (true) then restored (false).
    expect(stdin.events.rawModes).toEqual([true, false]);
    expect(stdin.events.resumed).toBe(1);
    expect(stdin.events.paused).toBe(1);
    // The reader has no write capability at all — nothing is ever echoed back.
    expect(stdin.events.writes).toEqual([]);
    expect(stdin).not.toHaveProperty('write');
  });

  it('applies backspace edits and stops at the newline', async () => {
    const stdin = fakeStdin();
    const pending = readHiddenLine(stdin);
    stdin.emit('abX');
    stdin.emit('\u007f'); // backspace removes the X
    stdin.emit('c');
    stdin.emit('\n');
    expect(await pending).toBe('abc');
    expect(stdin.events.rawModes).toEqual([true, false]);
  });

  it('rejects on Ctrl-C and still restores raw mode', async () => {
    const stdin = fakeStdin();
    const pending = readHiddenLine(stdin);
    stdin.emit('\u0003');
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(stdin.events.rawModes).toEqual([true, false]);
  });

  it('resolves on Ctrl-D with whatever was buffered', async () => {
    const stdin = fakeStdin();
    const pending = readHiddenLine(stdin);
    stdin.emit('partial');
    stdin.emit('\u0004');
    expect(await pending).toBe('partial');
    expect(stdin.events.rawModes).toEqual([true, false]);
  });
});
