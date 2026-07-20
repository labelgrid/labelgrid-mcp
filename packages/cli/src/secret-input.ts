/**
 * Hidden token entry for an interactive terminal.
 *
 * On a TTY, `labelgrid auth login` reads the pasted token with echo disabled:
 * the input stream is switched to raw mode (which suppresses the terminal's own
 * echo) and keystrokes are collected WITHOUT ever being written back, so the
 * secret never appears on screen or in any output stream. Enter (or Ctrl-D)
 * ends entry; Backspace edits; Ctrl-C aborts. Raw mode is always restored
 * before the promise settles. This module writes NOTHING itself — the caller
 * prints the prompt and the trailing newline — so a token value can never reach
 * stdout/stderr through here.
 */

// Control bytes handled during hidden entry.
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const DEL = '\u007f';
const BACKSPACE = '\b';

/** The minimal raw-capable readable-stream surface this reader drives. */
export type RawModeStdin = {
  setRawMode?(mode: boolean): void;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  removeListener(event: 'data', listener: (chunk: Buffer) => void): unknown;
  resume(): unknown;
  pause(): unknown;
};

/**
 * Reads one line from `stdin` with echo suppressed and resolves the typed text
 * (without the terminating newline). Backspace edits the buffer; Enter/Ctrl-D
 * finish; Ctrl-C rejects. Raw mode is restored before settling.
 */
export function readHiddenLine(stdin: RawModeStdin): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    const rawCapable = typeof stdin.setRawMode === 'function';
    const restore = (): void => {
      stdin.removeListener('data', onData);
      if (rawCapable) stdin.setRawMode?.(false);
      stdin.pause();
    };
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          restore();
          resolve(buffer);
          return;
        }
        if (ch === CTRL_C) {
          restore();
          reject(new Error('Token entry cancelled.'));
          return;
        }
        if (ch === CTRL_D) {
          restore();
          resolve(buffer);
          return;
        }
        if (ch === DEL || ch === BACKSPACE) {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };
    if (rawCapable) stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** The default hidden reader, bound to the process's stdin. */
export function defaultReadSecret(): Promise<string> {
  return readHiddenLine(process.stdin as unknown as RawModeStdin);
}
