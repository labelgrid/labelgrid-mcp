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

import { realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { ApiError, ApiResult } from '../api/http.js';
import { applyProjection } from '../projection.js';
import { VERSION } from '../version.js';
import type { ToolContext, ToolDef } from './types.js';

const INLINE_CSV_LIMIT = 100 * 1024;

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

/** Maps an error HTTP status from a raw download into a structured code. */
function statusToCode(status: number): string {
  if (status === 401) return 'TOKEN_INVALID';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'SERVER_ERROR';
  return 'ERROR';
}

/** Authenticated raw GET for file downloads; returns the Response or an error. */
async function authedGet(
  ctx: ToolContext,
  path: string,
): Promise<{ ok: true; res: Response } | { ok: false; error: ApiError }> {
  const base = ctx.config.baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await ctx.client.raw(`${base}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ctx.config.token}`,
        Accept: 'application/json',
        'User-Agent': `labelgrid-mcp/${VERSION}`,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network request failed.',
        status: 0,
      },
    };
  }
  if (!res.ok) {
    let message = `Request failed with status ${res.status}.`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const body = JSON.parse(text) as Record<string, unknown>;
          if (typeof body.message === 'string') message = body.message;
          else if (typeof body.error === 'string') message = body.error;
        } catch {
          message = text;
        }
      }
    } catch {
      // keep the default message
    }
    return { ok: false, error: { code: statusToCode(res.status), message, status: res.status } };
  }
  return { ok: true, res };
}

const queryFinancials: ToolDef = {
  name: 'query_financials',
  toolset: 'finance',
  gate: 'read',
  title: 'Query financial data',
  description:
    'Query your financial data. Pick ONE view with `view`: ' +
    '`statements` lists your royalty statements, paginated — filter with `filters` (label_id, release_id, isrc, upc, and a start_date/end_date range) and pass group_by="release" to roll the totals up per release. ' +
    '`statement_detail` retrieves one royalty statement by `invoice_number` (required for this view). ' +
    '`transactions` lists account transactions, paginated — same `filters`; sort with `sort`; group_by="release" rolls up per release. ' +
    '`royalty_breakdown` returns a cursor-paginated royalty breakdown grouped by one or more dimensions — `group_by` is REQUIRED for this view and is a comma-separated, ordered subset of: track, dsp, release, territory, period (e.g. "release,dsp"); same `filters`; pass `cursor` to page. ' +
    "Use download_statement for statement line items (CSV) or the invoice PDF. response_format:'detailed' returns the verbatim API response.",
  inputShape: {
    view: z
      .enum(['statements', 'statement_detail', 'transactions', 'royalty_breakdown'])
      .describe('Which financial read.'),
    invoice_number: z
      .string()
      .optional()
      .describe('The statement invoice number. Required for view statement_detail.'),
    group_by: z
      .string()
      .optional()
      .describe(
        'statements/transactions: "release" rolls totals up per release. royalty_breakdown: REQUIRED — comma-separated, ordered subset of: track, dsp, release, territory, period.',
      ),
    sort: z.string().optional().describe('Sort expression (view transactions).'),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Filter names → values, passed through verbatim: label_id, release_id, isrc, upc, start_date, end_date.',
      ),
    cursor: z.string().optional().describe('Pagination cursor (view royalty_breakdown).'),
    page: z.number().int().positive().optional().describe('1-based page number.'),
    per_page: z.number().int().positive().optional().describe('Items per page.'),
    response_format: z
      .enum(['concise', 'detailed'])
      .optional()
      .describe(
        "Response shape: 'concise' (default) projects the response down to the high-signal fields (ids are always kept); 'detailed' returns the verbatim API response.",
      ),
  },
  annotations: { readOnlyHint: true },
  handler: async (args, { client }) => {
    const view = args.view as string;
    let result: ApiResult<unknown>;
    if (view === 'statements') {
      result = await client.get('/statements', {
        group_by: args.group_by,
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
    "Download statement files. Pick the file with `format`: `csv` downloads statement line items as CSV — pass invoice_number for a single statement, OR a start_date/end_date range to export across statements; if save_to_path (an absolute path whose parent directory exists) is given, the CSV is written there — an existing file is never overwritten (returns FILE_EXISTS) — and the tool returns the byte count; otherwise the CSV is returned inline, truncated at 100KB (with truncated: true) — use save_to_path for large exports. `format: 'invoice_pdf'` downloads the invoice PDF for a statement — invoice_number and save_to_path are both REQUIRED (the PDF is binary); the PDF is written to save_to_path — an existing file is never overwritten (returns FILE_EXISTS) — and the tool returns the byte count.",
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
  handler: async (args, ctx): Promise<ApiResult<unknown>> => {
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
      const result = await authedGet(ctx, `/statements/${encodeURIComponent(invoice)}/invoice`);
      if (!result.ok) return { error: result.error };
      const bytes = Buffer.from(await result.res.arrayBuffer());
      const writeErr = writeNewFile(savePath, bytes);
      if (writeErr) return { error: writeErr };
      return { data: { saved_to: savePath, bytes: bytes.length } };
    }

    // format === 'csv'
    if (savePath !== undefined) {
      const err = validateSavePath(savePath);
      if (err) return { error: err };
    }
    let path: string;
    if (invoice !== undefined && invoice !== '') {
      path = `/statements/${encodeURIComponent(invoice)}/csv`;
    } else {
      const parts: string[] = [];
      if (args.start_date !== undefined)
        parts.push(`start_date=${encodeURIComponent(String(args.start_date))}`);
      if (args.end_date !== undefined)
        parts.push(`end_date=${encodeURIComponent(String(args.end_date))}`);
      path = `/statements/export/csv${parts.length > 0 ? `?${parts.join('&')}` : ''}`;
    }
    const result = await authedGet(ctx, path);
    if (!result.ok) return { error: result.error };
    const text = await result.res.text();
    const totalBytes = Buffer.byteLength(text);
    if (savePath !== undefined) {
      const writeErr = writeNewFile(savePath, text);
      if (writeErr) return { error: writeErr };
      return { data: { saved_to: savePath, bytes: totalBytes } };
    }
    const truncated = text.length > INLINE_CSV_LIMIT;
    const content = truncated ? text.slice(0, INLINE_CSV_LIMIT) : text;
    return { data: { content, truncated, bytes: totalBytes } };
  },
};

export const financeTools: ToolDef[] = [queryFinancials, downloadStatement];
