import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelGridClient } from '../../src/api/http.js';

/**
 * Every handle the bounded multipart read opens, with whether it was closed.
 * `shrinkStat` makes the next handle's stat report a smaller size than the file
 * has, which stands in for a file that grows after the size check.
 */
const state = vi.hoisted(() => ({
  opened: [] as Array<{ closed: boolean }>,
  shrinkStat: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      const record = { closed: false };
      state.opened.push(record);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        record.closed = true;
        return close();
      };
      if (state.shrinkStat) {
        const stat = handle.stat.bind(handle);
        handle.stat = (async (opts?: { bigint?: boolean }) => {
          const s = await stat(opts as { bigint: true });
          s.size = opts?.bigint ? 1n : (1 as unknown as bigint);
          return s;
        }) as typeof handle.stat;
      }
      return handle;
    },
  };
});

function client(fetchFn: typeof fetch): LabelGridClient {
  return new LabelGridClient({
    baseUrl: 'https://api.example.test/api/public',
    token: 't',
    fetchFn,
    version: 't',
  });
}

describe('postMultipart bounded read closes its file handle', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-multipart-handle-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    state.opened.length = 0;
    state.shrinkStat = false;
  });

  it('closes the handle when the size check returns FILE_TOO_LARGE', async () => {
    const pdf = join(dir, 'big.pdf');
    writeFileSync(pdf, Buffer.alloc(20, 0x25));
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    const r = await client(fetchFn as unknown as typeof fetch).postMultipart(
      '/x',
      pdf,
      'file',
      undefined,
      { maxBytes: 10 },
    );
    expect('error' in r && r.error.code).toBe('FILE_TOO_LARGE');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(state.opened).toEqual([{ closed: true }]);
  });

  it('stops reading at the limit and closes the handle when the file grew after the check', async () => {
    const pdf = join(dir, 'grown.pdf');
    writeFileSync(pdf, Buffer.alloc(20, 0x25));
    state.shrinkStat = true;
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    const r = await client(fetchFn as unknown as typeof fetch).postMultipart(
      '/x',
      pdf,
      'file',
      undefined,
      { maxBytes: 10 },
    );
    expect('error' in r && r.error.code).toBe('FILE_TOO_LARGE');
    expect('error' in r && r.error.message).toMatch(/over the 10-byte upload limit/);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(state.opened).toEqual([{ closed: true }]);
  });

  it('reads the whole file through regrowth when it grew but stays within the limit', async () => {
    const pdf = join(dir, 'grown-ok.pdf');
    const bytes = Buffer.from('0123456789');
    writeFileSync(pdf, bytes);
    state.shrinkStat = true;
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    const r = await client(fetchFn as unknown as typeof fetch).postMultipart(
      '/x',
      pdf,
      'file',
      undefined,
      { maxBytes: 100 },
    );
    expect('data' in r).toBe(true);
    const form = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(Buffer.from(await (form.get('file') as File).arrayBuffer())).toEqual(bytes);
    expect(state.opened).toEqual([{ closed: true }]);
  });
});
