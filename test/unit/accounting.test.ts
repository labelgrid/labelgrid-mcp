import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type ApiResult, LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { accountingTools } from '../../src/tools/accounting.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

type Responder = (url: string, init: RequestInit) => Promise<Response>;

function harness(responder?: Responder) {
  const fetchFn = vi.fn(
    responder ?? (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  const client = new LabelGridClient({
    baseUrl: 'https://api.example.test/api/public',
    token: 'tok',
    fetchFn: fetchFn as unknown as typeof fetch,
    version: 't',
  });
  const config: Config = {
    baseUrl: 'https://api.example.test/api/public',
    token: 'tok',
    setupMode: false,
    writes: true,
    fullWrites: true,
    toolsets: null,
  };
  return { fetchFn, ctx: { client, config } as ToolContext };
}
function byName(name: string): ToolDef {
  const t = accountingTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function isErr<T>(r: ApiResult<T>): r is { error: { code: string; message: string } } {
  return 'error' in r;
}
function data<T>(r: ApiResult<T>): T {
  if ('data' in r) return r.data;
  throw new Error(`expected data, got error: ${JSON.stringify(r.error)}`);
}

describe('accounting toolset shape', () => {
  it('exports 9 read-only tools in the accounting toolset', () => {
    expect(accountingTools.map((t) => t.name)).toEqual([
      'list_statements',
      'get_statement',
      'download_statement_csv',
      'download_statement_invoice',
      'list_transactions',
      'get_royalties_breakdown',
      'list_artificial_streams',
      'get_artificial_fee_breakdown',
      'get_account_summary',
    ]);
    for (const t of accountingTools) {
      expect(t.gate).toBe('read');
      expect(t.toolset).toBe('accounting');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe('plain accounting reads', () => {
  it('list_statements → GET /statements with group_by and filters', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_statements').handler(
      { group_by: 'release', label_id: 42, start_date: '2026-01-01' },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/statements');
    expect(url).toContain('group_by=release');
    expect(url).toContain('filter[label_id]=42');
    expect(url).toContain('filter[start_date]=2026-01-01');
  });

  it('get_statement → GET /statements/{invoiceNumber}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_statement').handler({ invoice_number: 'INV202601' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/statements/INV202601');
  });

  it('list_transactions → GET /transactions with pagination + filters', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_transactions').handler({ page: 1, per_page: 25, release_id: 5 }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('/transactions');
    expect(url).toContain('per_page=25');
    expect(url).toContain('filter[release_id]=5');
  });

  it('get_royalties_breakdown requires group_by and maps filters', async () => {
    const { fetchFn, ctx } = harness();
    const tool = byName('get_royalties_breakdown');
    expect(z.object(tool.inputShape).safeParse({}).success).toBe(false);
    await tool.handler({ group_by: 'release,dsp', per_page: 100, label_id: 42 }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('/royalties/breakdown');
    expect(url).toContain('group_by=release,dsp');
    expect(url).toContain('filter[label_id]=42');
  });

  it('list_artificial_streams → GET /royalties/artificial-streams with top-level params', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_artificial_streams').handler({ dsp: 'spotify', release_id: 7 }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('/royalties/artificial-streams');
    expect(url).toContain('dsp=spotify');
    expect(url).toContain('release_id=7');
    expect(
      z.object(byName('list_artificial_streams').inputShape).safeParse({ dsp: 'tidal' }).success,
    ).toBe(false);
  });

  it('get_artificial_fee_breakdown → GET /artificial-streaming-fee/{period}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_artificial_fee_breakdown').handler({ period: '2026-01' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/artificial-streaming-fee/2026-01');
  });

  it('get_account_summary → GET /account', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_account_summary').handler({}, ctx);
    expect(lastUrl(fetchFn)).toContain('/account');
  });
});

describe('download_statement_csv', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-acct-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const csvResponder: Responder = async () => new Response('a,b\n1,2\n', { status: 200 });

  it('selects the per-invoice CSV path when invoice_number is given', async () => {
    const { fetchFn, ctx } = harness(csvResponder);
    await byName('download_statement_csv').handler({ invoice_number: 'INV-9' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/statements/INV-9/csv');
  });

  it('selects the export CSV path with date range when no invoice_number', async () => {
    const { fetchFn, ctx } = harness(csvResponder);
    await byName('download_statement_csv').handler(
      { start_date: '2026-01-01', end_date: '2026-01-31' },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/statements/export/csv');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-01-31');
  });

  it('writes the CSV to an absolute save_to_path and reports bytes', async () => {
    const { ctx } = harness(csvResponder);
    const savePath = join(dir, 'out.csv');
    const r = await byName('download_statement_csv').handler(
      { invoice_number: 'INV-9', save_to_path: savePath },
      ctx,
    );
    expect(existsSync(savePath)).toBe(true);
    expect(readFileSync(savePath, 'utf8')).toBe('a,b\n1,2\n');
    const d = data(r) as { saved_to: string; bytes: number };
    expect(d.saved_to).toBe(savePath);
    expect(d.bytes).toBe(8);
  });

  it('rejects a relative save_to_path without any HTTP call', async () => {
    const { fetchFn, ctx } = harness(csvResponder);
    const r = await byName('download_statement_csv').handler(
      { invoice_number: 'INV-9', save_to_path: 'relative/out.csv' },
      ctx,
    );
    expect(isErr(r)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a save_to_path whose parent directory does not exist', async () => {
    const { fetchFn, ctx } = harness(csvResponder);
    const r = await byName('download_statement_csv').handler(
      { invoice_number: 'INV-9', save_to_path: join(dir, 'nope', 'out.csv') },
      ctx,
    );
    expect(isErr(r)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never overwrites an existing file — returns FILE_EXISTS on the second write', async () => {
    const { ctx } = harness(csvResponder);
    const savePath = join(dir, 'exists.csv');
    const first = await byName('download_statement_csv').handler(
      { invoice_number: 'INV-9', save_to_path: savePath },
      ctx,
    );
    expect(isErr(first)).toBe(false);
    const second = await byName('download_statement_csv').handler(
      { invoice_number: 'INV-9', save_to_path: savePath },
      ctx,
    );
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('FILE_EXISTS');
  });

  it('returns inline CSV truncated at 100KB with a truncated marker', async () => {
    const big = `${'x'.repeat(200 * 1024)}`;
    const { ctx } = harness(async () => new Response(big, { status: 200 }));
    const r = await byName('download_statement_csv').handler({ invoice_number: 'INV-9' }, ctx);
    const d = data(r) as { content: string; truncated: boolean; bytes: number };
    expect(d.truncated).toBe(true);
    expect(d.content.length).toBe(100 * 1024);
    expect(d.bytes).toBe(200 * 1024);
  });

  it('returns inline CSV untruncated when small', async () => {
    const { ctx } = harness(csvResponder);
    const r = await byName('download_statement_csv').handler({ invoice_number: 'INV-9' }, ctx);
    const d = data(r) as { content: string; truncated: boolean };
    expect(d.truncated).toBe(false);
    expect(d.content).toBe('a,b\n1,2\n');
  });

  it('passes through a 404 as a structured error', async () => {
    const { ctx } = harness(async () => new Response('{"message":"gone"}', { status: 404 }));
    const r = await byName('download_statement_csv').handler({ invoice_number: 'INV-X' }, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });
});

describe('download_statement_invoice', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-inv-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('requires both invoice_number and save_to_path', () => {
    const schema = z.object(byName('download_statement_invoice').inputShape);
    expect(schema.safeParse({ invoice_number: 'INV-1' }).success).toBe(false);
    expect(schema.safeParse({ save_to_path: '/tmp/x.pdf' }).success).toBe(false);
    expect(schema.safeParse({ invoice_number: 'INV-1', save_to_path: '/tmp/x.pdf' }).success).toBe(
      true,
    );
  });

  it('writes the binary PDF to save_to_path', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const { fetchFn, ctx } = harness(async () => new Response(pdfBytes, { status: 200 }));
    const savePath = join(dir, 'invoice.pdf');
    const r = await byName('download_statement_invoice').handler(
      { invoice_number: 'INV-1', save_to_path: savePath },
      ctx,
    );
    expect(lastUrl(fetchFn)).toContain('/statements/INV-1/invoice');
    expect(existsSync(savePath)).toBe(true);
    expect(new Uint8Array(readFileSync(savePath))).toEqual(pdfBytes);
    const d = data(r) as { saved_to: string; bytes: number };
    expect(d.bytes).toBe(5);
  });

  it('never overwrites an existing PDF — returns FILE_EXISTS on the second write', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const { ctx } = harness(async () => new Response(pdfBytes, { status: 200 }));
    const savePath = join(dir, 'once.pdf');
    const first = await byName('download_statement_invoice').handler(
      { invoice_number: 'INV-1', save_to_path: savePath },
      ctx,
    );
    expect(isErr(first)).toBe(false);
    const second = await byName('download_statement_invoice').handler(
      { invoice_number: 'INV-1', save_to_path: savePath },
      ctx,
    );
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('FILE_EXISTS');
  });
});
