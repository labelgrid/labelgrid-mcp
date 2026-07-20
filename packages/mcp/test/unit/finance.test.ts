import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ApiResult, LabelGridClient } from '@labelgrid/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Config } from '../../src/config.js';
import { financeTools } from '../../src/tools/finance.js';
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
  const t = financeTools.find((x) => x.name === name);
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

describe('finance toolset shape', () => {
  it('exports the two read-only finance tools', () => {
    expect(financeTools.map((t) => t.name)).toEqual(['query_financials', 'download_statement']);
    for (const t of financeTools) {
      expect(t.toolset).toBe('finance');
      expect(t.gate).toBe('read');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe('query_financials', () => {
  it('rejects an unknown view via zod', () => {
    const schema = z.object(byName('query_financials').inputShape);
    expect(schema.safeParse({ view: 'balance' }).success).toBe(false);
    expect(schema.safeParse({ view: 'statements' }).success).toBe(true);
  });

  it('view=statements → GET /statements with group_by and filter[...] params', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_financials').handler(
      {
        view: 'statements',
        group_by: 'release',
        filters: { label_id: 42, start_date: '2026-01-01' },
      },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/statements');
    expect(url).toContain('group_by=release');
    expect(url).toContain('filter[label_id]=42');
    expect(url).toContain('filter[start_date]=2026-01-01');
  });

  it('view=statements forwards page and per_page (and filters) into the query string', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_financials').handler(
      { view: 'statements', page: 2, per_page: 50, filters: { label_id: 42 } },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/statements');
    expect(url).toContain('page=2');
    expect(url).toContain('per_page=50');
    expect(url).toContain('filter[label_id]=42');
  });

  it('view=statement_detail → GET /statements/{invoiceNumber}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_financials').handler(
      { view: 'statement_detail', invoice_number: 'INV202601' },
      ctx,
    );
    expect(lastUrl(fetchFn)).toContain('/statements/INV202601');
  });

  it('view=statement_detail without invoice_number → INVALID_SELECTOR naming it, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('query_financials').handler({ view: 'statement_detail' }, ctx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('INVALID_SELECTOR');
      expect(r.error.message).toContain('invoice_number');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('view=transactions → GET /transactions with pagination, sort and filters', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_financials').handler(
      { view: 'transactions', page: 1, per_page: 25, sort: '-date', filters: { release_id: 5 } },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/transactions');
    expect(url).toContain('per_page=25');
    expect(url).toContain('sort=-date');
    expect(url).toContain('filter[release_id]=5');
  });

  it('view=royalty_breakdown → GET /royalties/breakdown with group_by, cursor and filters', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_financials').handler(
      {
        view: 'royalty_breakdown',
        group_by: 'release,dsp',
        per_page: 100,
        cursor: 'abc',
        filters: { label_id: 42 },
      },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/royalties/breakdown');
    expect(url).toContain('group_by=release,dsp');
    expect(url).toContain('cursor=abc');
    expect(url).toContain('filter[label_id]=42');
  });

  it('says group_by is REQUIRED for royalty_breakdown in the description', () => {
    const desc = byName('query_financials').description;
    expect(desc).toContain('REQUIRED');
    expect(desc).toContain('track, dsp, release, territory, period');
  });

  it('projects concise by default: allowlisted fields + ids survive', async () => {
    const payload = {
      data: [{ id: 7, invoice_number: 'INV202601', gross_usd: '12.34', memo_blob: 'drop me' }],
    };
    const { ctx } = harness(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const r = await byName('query_financials').handler({ view: 'statements' }, ctx);
    const d = data(r) as Record<string, unknown>;
    expect(d._projection).toBe('concise');
    expect(d.data).toEqual([{ id: 7, invoice_number: 'INV202601', gross_usd: '12.34' }]);
  });

  it("response_format='detailed' returns the verbatim response", async () => {
    const payload = { data: [{ id: 7, memo_blob: 'kept' }] };
    const { ctx } = harness(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const r = await byName('query_financials').handler(
      { view: 'statements', response_format: 'detailed' },
      ctx,
    );
    expect(data(r)).toEqual(payload);
  });
});

describe('download_statement format=csv', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-fin-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const csvResponder: Responder = async () => new Response('a,b\n1,2\n', { status: 200 });

  it('selects the per-invoice CSV path when invoice_number is given', async () => {
    const { fetchFn, ctx } = harness(csvResponder);
    await byName('download_statement').handler({ format: 'csv', invoice_number: 'INV-9' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/statements/INV-9/csv');
  });

  it('selects the export CSV path with date range when no invoice_number', async () => {
    const { fetchFn, ctx } = harness(csvResponder);
    await byName('download_statement').handler(
      { format: 'csv', start_date: '2026-01-01', end_date: '2026-01-31' },
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
    const r = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-9', save_to_path: savePath },
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
    const r = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-9', save_to_path: 'relative/out.csv' },
      ctx,
    );
    expect(isErr(r)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a save_to_path whose parent directory does not exist', async () => {
    const { fetchFn, ctx } = harness(csvResponder);
    const r = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-9', save_to_path: join(dir, 'nope', 'out.csv') },
      ctx,
    );
    expect(isErr(r)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never overwrites an existing file — returns FILE_EXISTS on the second write', async () => {
    const { ctx } = harness(csvResponder);
    const savePath = join(dir, 'exists.csv');
    const first = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-9', save_to_path: savePath },
      ctx,
    );
    expect(isErr(first)).toBe(false);
    const second = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-9', save_to_path: savePath },
      ctx,
    );
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('FILE_EXISTS');
  });

  it('returns inline CSV truncated at 100KB with a truncated marker', async () => {
    const big = `${'x'.repeat(200 * 1024)}`;
    const { ctx } = harness(async () => new Response(big, { status: 200 }));
    const r = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-9' },
      ctx,
    );
    const d = data(r) as { content: string; truncated: boolean; bytes: number };
    expect(d.truncated).toBe(true);
    expect(d.content.length).toBe(100 * 1024);
    expect(d.bytes).toBe(200 * 1024);
  });

  it('returns inline CSV untruncated when small', async () => {
    const { ctx } = harness(csvResponder);
    const r = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-9' },
      ctx,
    );
    const d = data(r) as { content: string; truncated: boolean };
    expect(d.truncated).toBe(false);
    expect(d.content).toBe('a,b\n1,2\n');
  });

  it('passes through a 404 as a structured error', async () => {
    const { ctx } = harness(async () => new Response('{"message":"gone"}', { status: 404 }));
    const r = await byName('download_statement').handler(
      { format: 'csv', invoice_number: 'INV-X' },
      ctx,
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });
});

describe('download_statement format=invoice_pdf', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-inv-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('without invoice_number → INVALID_SELECTOR naming it, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('download_statement').handler(
      { format: 'invoice_pdf', save_to_path: join(dir, 'x.pdf') },
      ctx,
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('INVALID_SELECTOR');
      expect(r.error.message).toContain('invoice_number');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('without save_to_path → INVALID_SELECTOR naming it, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('download_statement').handler(
      { format: 'invoice_pdf', invoice_number: 'INV-1' },
      ctx,
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('INVALID_SELECTOR');
      expect(r.error.message).toContain('save_to_path');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('writes the binary PDF to save_to_path', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const { fetchFn, ctx } = harness(async () => new Response(pdfBytes, { status: 200 }));
    const savePath = join(dir, 'invoice.pdf');
    const r = await byName('download_statement').handler(
      { format: 'invoice_pdf', invoice_number: 'INV-1', save_to_path: savePath },
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
    const first = await byName('download_statement').handler(
      { format: 'invoice_pdf', invoice_number: 'INV-1', save_to_path: savePath },
      ctx,
    );
    expect(isErr(first)).toBe(false);
    const second = await byName('download_statement').handler(
      { format: 'invoice_pdf', invoice_number: 'INV-1', save_to_path: savePath },
      ctx,
    );
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('FILE_EXISTS');
  });
});
