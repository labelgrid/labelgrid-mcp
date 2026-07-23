/**
 * Finance toolset: the consolidated financial query (statements, transactions,
 * royalty breakdowns) and statement downloads. All read-only.
 *
 * `download_statement` fetches a file body. It validates the caller-supplied
 * `save_to_path` and writes ONLY there; a CSV without a save path is returned
 * inline, truncated at 100KB. Downloads use an authenticated raw GET (the
 * shared client's JSON path would corrupt binary PDFs), with the same auth
 * headers the client sends.
 */

import { createWriteStream, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApiError, ApiResult } from '@labelgrid/core';
import { z } from 'zod';
import { applyProjection } from '../projection.js';
import type { ToolDef } from './types.js';

const INLINE_CSV_LIMIT = 100 * 1024;

/**
 * Hard ceiling on the CSV body read into memory when NO save_to_path is given.
 * A larger export must be written to disk (save_to_path streams it); reading an
 * unbounded body inline is exactly the memory blow-up this bound prevents.
 */
const MAX_INLINE_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Reads a text body with a byte ceiling enforced up front (Content-Length) AND
 * mid-stream: it aborts the moment the running byte count crosses `max`, so an
 * oversized body is never fully buffered. Returns the decoded text or a
 * RESPONSE_TOO_LARGE error naming save_to_path as the way to handle a big export.
 */
async function readBoundedText(res: Response, max: number): Promise<string | ApiError> {
  const tooLarge: ApiError = {
    code: 'RESPONSE_TOO_LARGE',
    message: `The export exceeds the ${max}-byte inline limit. Pass save_to_path to stream it to a file instead.`,
    status: res.status,
  };
  const declared = Number.parseInt(res.headers.get('Content-Length') ?? '', 10);
  if (!Number.isNaN(declared) && declared > max) return tooLarge;
  if (!res.body) {
    const text = await res.text();
    return Buffer.byteLength(text) > max ? tooLarge : text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        try {
          await reader.cancel();
        } catch {
          // best-effort — the size bound is what matters
        }
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

/**
 * Validates that save_to_path is absolute and its parent resolves (via
 * realpathSync, so a dangling/symlinked parent is rejected) to an existing real
 * directory. Writing itself is exclusive (see writeNewFile), so this never
 * overwrites an existing file.
 */
function validateSavePath(p: string): ApiError | null {
  if (!isAbsolute(p)) {
    return {
      code: 'INVALID_PATH',
      message: `save_to_path must be an absolute path (received: ${p}).`,
      status: 0,
    };
  }
  const dir = dirname(p);
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    return {
      code: 'INVALID_PATH',
      message: `The parent directory of save_to_path does not exist: ${dir}.`,
      status: 0,
    };
  }
  let isDir = false;
  try {
    isDir = statSync(realDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return {
      code: 'INVALID_PATH',
      message: `The parent directory of save_to_path is not a directory: ${dir}.`,
      status: 0,
    };
  }
  return null;
}

/**
 * Writes a file with exclusive creation ('wx'): an existing path is NEVER
 * overwritten. Returns FILE_EXISTS on collision, or a structured write error,
 * or null on success.
 */
function writeNewFile(path: string, data: string | Buffer): ApiError | null {
  try {
    writeFileSync(path, data, { flag: 'wx' });
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        code: 'FILE_EXISTS',
        message: `A file already exists at ${path}. This tool never overwrites — choose a new path.`,
        status: 0,
      };
    }
    return {
      code: 'WRITE_FAILED',
      message: `Could not write to ${path}: ${err instanceof Error ? err.message : 'unknown error'}.`,
      status: 0,
    };
  }
}

/**
 * Streams a web response body to a NEW file with exclusive creation ('wx'): an
 * existing path is NEVER overwritten. Never buffers the whole body in memory.
 * Returns the bytes written, FILE_EXISTS on collision, or a structured write
 * error.
 */
async function streamNewFile(
  path: string,
  body: ReadableStream<Uint8Array> | null,
): Promise<{ bytes: number } | ApiError> {
  if (body === null) {
    const err = writeNewFile(path, Buffer.alloc(0));
    return err ?? { bytes: 0 };
  }
  const ws = createWriteStream(path, { flags: 'wx' });
  try {
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), ws);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        code: 'FILE_EXISTS',
        message: `A file already exists at ${path}. This tool never overwrites — choose a new path.`,
        status: 0,
      };
    }
    return {
      code: 'WRITE_FAILED',
      message: `Could not write to ${path}: ${err instanceof Error ? err.message : 'unknown error'}.`,
      status: 0,
    };
  }
  return { bytes: statSync(path).size };
}

const queryFinancials: ToolDef = {
  name: 'query_financials',
  toolset: 'finance',
  gate: 'read',
  title: 'Query financial data',
  description:
    'Query your financial data. Pick ONE view with `view`: ' +
    '`statements` lists your royalty statements, paginated — `filters`: label_id, release_id, isrc, upc, start_date/end_date; group_by="release" rolls totals up per release. ' +
    '`statement_detail` retrieves one statement by `invoice_number` (required). ' +
    '`transactions` lists account transactions, paginated — same `filters`; sort with `sort`; group_by="release" rolls up per release. ' +
    '`royalty_breakdown` returns a cursor-paginated royalty breakdown — `group_by` is REQUIRED for this view: a comma-separated, ordered subset of: track, dsp, release, territory, period (e.g. "release,dsp"); same `filters`; pass `cursor` to page. ' +
    "Use download_statement for statement line items (CSV) or the invoice PDF. response_format:'detailed' returns the verbatim API response.",
  inputShape: {
    view: z
      .enum(['statements', 'statement_detail', 'transactions', 'royalty_breakdown'])
      .describe('Which financial read.'),
    invoice_number: z.string().optional().describe('Required for view statement_detail.'),
    group_by: z
      .string()
      .optional()
      .describe(
        'REQUIRED for royalty_breakdown (ordered subset: track, dsp, release, territory, period); "release" rolls statements/transactions up per release.',
      ),
    sort: z.string().optional().describe('Sort expression (view transactions).'),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('label_id, release_id, isrc, upc, start_date, end_date — passed through verbatim.'),
    cursor: z.string().optional().describe('Pagination cursor (view royalty_breakdown).'),
    page: z.number().int().positive().optional().describe('1-based page number.'),
    per_page: z.number().int().positive().optional().describe('Items per page.'),
    response_format: z
      .enum(['concise', 'detailed'])
      .optional()
      .describe(
        "'concise' (default) keeps only the high-signal fields (ids always kept); 'detailed' returns the verbatim API response.",
      ),
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const view = args.view as string;
    let result: ApiResult<unknown>;
    if (view === 'statements') {
      result = await client.get('/statements', {
        group_by: args.group_by,
        page: args.page,
        per_page: args.per_page,
        filter: args.filters,
      });
    } else if (view === 'statement_detail') {
      if (args.invoice_number === undefined) {
        return {
          error: {
            code: 'INVALID_SELECTOR',
            message:
              "view 'statement_detail' requires `invoice_number` — the statement invoice number.",
            status: 0,
          },
        };
      }
      result = await client.get(`/statements/${encodeURIComponent(String(args.invoice_number))}`);
    } else if (view === 'transactions') {
      result = await client.get('/transactions', {
        group_by: args.group_by,
        page: args.page,
        per_page: args.per_page,
        sort: args.sort,
        filter: args.filters,
      });
    } else {
      result = await client.get('/royalties/breakdown', {
        group_by: args.group_by,
        per_page: args.per_page,
        cursor: args.cursor,
        filter: args.filters,
      });
    }
    return applyProjection(result, 'query_financials', args.response_format);
  },
};

const downloadStatement: ToolDef = {
  name: 'download_statement',
  toolset: 'finance',
  gate: 'read',
  title: 'Download a statement file',
  description:
    "Download statement files. `format: 'csv'` downloads statement line items — pass invoice_number for one statement, OR a start_date/end_date range to export across statements; with save_to_path (an absolute path whose parent directory exists) the CSV is written there and the byte count returned; otherwise it is returned inline, truncated at 100KB (truncated: true) — use save_to_path for large exports. `format: 'invoice_pdf'` downloads the invoice PDF — invoice_number and save_to_path are both REQUIRED (the PDF is binary). An existing file is never overwritten (returns FILE_EXISTS).",
  inputShape: {
    format: z
      .enum(['csv', 'invoice_pdf'])
      .describe('Which file: csv (line items) or invoice_pdf (the invoice PDF).'),
    invoice_number: z
      .string()
      .optional()
      .describe('Single-statement invoice number. Required for format invoice_pdf.'),
    start_date: z.string().optional().describe('CSV export range start, YYYY-MM-DD.'),
    end_date: z.string().optional().describe('CSV export range end, YYYY-MM-DD.'),
    save_to_path: z
      .string()
      .optional()
      .describe(
        'Absolute path (existing parent dir) to write the file to. Optional for csv (otherwise returned inline); required for invoice_pdf.',
      ),
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }): Promise<ApiResult<unknown>> => {
    const invoice = args.invoice_number as string | undefined;
    const savePath = args.save_to_path as string | undefined;

    if (args.format === 'invoice_pdf') {
      if (invoice === undefined || invoice === '') {
        return {
          error: {
            code: 'INVALID_SELECTOR',
            message:
              "format 'invoice_pdf' requires `invoice_number` — the statement invoice number.",
            status: 0,
          },
        };
      }
      if (savePath === undefined) {
        return {
          error: {
            code: 'INVALID_SELECTOR',
            message:
              "format 'invoice_pdf' requires `save_to_path` — an absolute path to write the binary PDF to.",
            status: 0,
          },
        };
      }
      const err = validateSavePath(savePath);
      if (err) return { error: err };
      const result = await client.getRaw(`/statements/${encodeURIComponent(invoice)}/invoice`);
      if (!result.ok) return { error: result.error };
      const written = await streamNewFile(savePath, result.res.body);
      if ('code' in written) return { error: written };
      return { data: { saved_to: savePath, bytes: written.bytes } };
    }

    // format === 'csv'
    if (savePath !== undefined) {
      const err = validateSavePath(savePath);
      if (err) return { error: err };
    }
    let path: string;
    let query: Record<string, unknown> | undefined;
    if (invoice !== undefined && invoice !== '') {
      path = `/statements/${encodeURIComponent(invoice)}/csv`;
    } else {
      // Let the core client serialize the range (its buildQuery), not a
      // hand-rolled query string.
      path = '/statements/export/csv';
      query = { start_date: args.start_date, end_date: args.end_date };
    }
    const result = await client.getRaw(path, query);
    if (!result.ok) return { error: result.error };
    if (savePath !== undefined) {
      // Stream the export straight to disk — never buffer the whole CSV.
      const written = await streamNewFile(savePath, result.res.body);
      if ('code' in written) return { error: written };
      return { data: { saved_to: savePath, bytes: written.bytes } };
    }
    // Inline: read with the byte ceiling enforced (Content-Length + mid-stream).
    const text = await readBoundedText(result.res, MAX_INLINE_DOWNLOAD_BYTES);
    if (typeof text !== 'string') return { error: text };
    const totalBytes = Buffer.byteLength(text);
    const truncated = text.length > INLINE_CSV_LIMIT;
    const content = truncated ? text.slice(0, INLINE_CSV_LIMIT) : text;
    return { data: { content, truncated, bytes: totalBytes } };
  },
};

export const financeTools: ToolDef[] = [queryFinancials, downloadStatement];
