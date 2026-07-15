/**
 * Accounting toolset: statements, transactions, royalty breakdowns,
 * artificial-streaming records, and the account summary. All read-only.
 *
 * Two tools (`download_statement_csv`, `download_statement_invoice`) fetch a
 * file body. They validate the caller-supplied `save_to_path` and write ONLY
 * there; a CSV without a save path is returned inline, truncated at 100KB.
 * These downloads use an authenticated raw GET (the shared client's JSON path
 * would corrupt binary PDFs), with the same auth headers the client sends.
 */

import { realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { ApiError, ApiResult } from '../api/http.js';
import { VERSION } from '../version.js';
import type { ToolContext, ToolDef } from './types.js';

const INLINE_CSV_LIMIT = 100 * 1024;
const readOnly = { readOnlyHint: true } as const;

// Common optional filter fields shared across the accounting reads.
const labelId = z.number().int().positive().optional().describe('Filter by label id.');
const releaseId = z.number().int().positive().optional().describe('Filter by release id.');
const isrc = z.string().optional().describe('Filter by ISRC.');
const upc = z.string().optional().describe('Filter by UPC/barcode.');
const startDate = z.string().optional().describe('Range start, YYYY-MM-DD.');
const endDate = z.string().optional().describe('Range end, YYYY-MM-DD.');
const perPage = z.number().int().positive().optional().describe('Items per page.');

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

const listStatements: ToolDef = {
  name: 'list_statements',
  toolset: 'accounting',
  gate: 'read',
  title: 'List statements',
  description:
    'List your royalty statements, paginated. Filter by label_id, release_id, isrc, upc, and a start_date/end_date range. Pass group_by="release" to roll the totals up per release. Use get_statement for one statement, or download_statement_csv for its line items.',
  inputShape: {
    group_by: z.enum(['release']).optional().describe('Roll totals up per release.'),
    label_id: labelId,
    release_id: releaseId,
    isrc,
    upc,
    start_date: startDate,
    end_date: endDate,
  },
  annotations: readOnly,
  handler: (args, { client }) => {
    const { group_by, label_id, release_id, isrc: i, upc: u, start_date, end_date } = args;
    return client.get('/statements', {
      group_by,
      filter: { label_id, release_id, isrc: i, upc: u, start_date, end_date },
    });
  },
};

const getStatement: ToolDef = {
  name: 'get_statement',
  toolset: 'accounting',
  gate: 'read',
  title: 'Get a statement',
  description: 'Retrieve one royalty statement by its invoice number.',
  inputShape: { invoice_number: z.string().describe('The statement invoice number.') },
  annotations: readOnly,
  handler: (args, { client }) =>
    client.get(`/statements/${encodeURIComponent(String(args.invoice_number))}`),
};

const downloadStatementCsv: ToolDef = {
  name: 'download_statement_csv',
  toolset: 'accounting',
  gate: 'read',
  title: 'Download statement CSV',
  description:
    'Download statement line items as CSV. Pass invoice_number for a single statement, OR a start_date/end_date range to export across statements. If save_to_path (an absolute path whose parent directory exists) is given, the CSV is written there — an existing file is never overwritten (returns FILE_EXISTS) — and the tool returns the byte count. Otherwise the CSV is returned inline, truncated at 100KB (with truncated: true) — use save_to_path for large exports.',
  inputShape: {
    invoice_number: z.string().optional().describe('Single-statement invoice number.'),
    start_date: z.string().optional().describe('Export range start, YYYY-MM-DD.'),
    end_date: z.string().optional().describe('Export range end, YYYY-MM-DD.'),
    save_to_path: z
      .string()
      .optional()
      .describe(
        'Absolute path (existing parent dir) to write the CSV to instead of returning it inline.',
      ),
  },
  annotations: readOnly,
  handler: async (args, ctx): Promise<ApiResult<unknown>> => {
    const savePath = args.save_to_path as string | undefined;
    if (savePath !== undefined) {
      const err = validateSavePath(savePath);
      if (err) return { error: err };
    }
    const invoice = args.invoice_number as string | undefined;
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

const downloadStatementInvoice: ToolDef = {
  name: 'download_statement_invoice',
  toolset: 'accounting',
  gate: 'read',
  title: 'Download statement invoice PDF',
  description:
    'Download the invoice PDF for a statement. save_to_path is REQUIRED (the PDF is binary) and must be an absolute path whose parent directory exists; the PDF is written there — an existing file is never overwritten (returns FILE_EXISTS) — and the tool returns the byte count.',
  inputShape: {
    invoice_number: z.string().describe('The statement invoice number.'),
    save_to_path: z
      .string()
      .describe('Absolute path (existing parent dir) to write the PDF to. Required.'),
  },
  annotations: readOnly,
  handler: async (args, ctx): Promise<ApiResult<unknown>> => {
    const savePath = args.save_to_path as string;
    const err = validateSavePath(savePath);
    if (err) return { error: err };
    const invoice = encodeURIComponent(String(args.invoice_number));
    const result = await authedGet(ctx, `/statements/${invoice}/invoice`);
    if (!result.ok) return { error: result.error };
    const bytes = Buffer.from(await result.res.arrayBuffer());
    const writeErr = writeNewFile(savePath, bytes);
    if (writeErr) return { error: writeErr };
    return { data: { saved_to: savePath, bytes: bytes.length } };
  },
};

const listTransactions: ToolDef = {
  name: 'list_transactions',
  toolset: 'accounting',
  gate: 'read',
  title: 'List transactions',
  description:
    'List account transactions, paginated. Filter by label_id, release_id, isrc, upc, and a start_date/end_date range; sort with `sort`; pass group_by="release" to roll up per release.',
  inputShape: {
    group_by: z.enum(['release']).optional(),
    page: z.number().int().positive().optional(),
    per_page: perPage,
    sort: z.string().optional().describe('Sort expression.'),
    label_id: labelId,
    release_id: releaseId,
    isrc,
    upc,
    start_date: startDate,
    end_date: endDate,
  },
  annotations: readOnly,
  handler: (args, { client }) => {
    const {
      group_by,
      page,
      per_page,
      sort,
      label_id,
      release_id,
      isrc: i,
      upc: u,
      start_date,
      end_date,
    } = args;
    return client.get('/transactions', {
      group_by,
      page,
      per_page,
      sort,
      filter: { label_id, release_id, isrc: i, upc: u, start_date, end_date },
    });
  },
};

const getRoyaltiesBreakdown: ToolDef = {
  name: 'get_royalties_breakdown',
  toolset: 'accounting',
  gate: 'read',
  title: 'Get royalties breakdown',
  description:
    'Get a cursor-paginated royalty breakdown grouped by one or more dimensions. group_by is REQUIRED and is a comma-separated, ordered subset of: track, dsp, release, territory, period (e.g. "release,dsp"). Filter by label_id, release_id, isrc, upc, and a start_date/end_date range.',
  inputShape: {
    group_by: z
      .string()
      .describe(
        'Required. Comma-separated, ordered subset of: track, dsp, release, territory, period.',
      ),
    per_page: perPage,
    cursor: z.string().optional().describe('Pagination cursor.'),
    label_id: labelId,
    release_id: releaseId,
    isrc,
    upc,
    start_date: startDate,
    end_date: endDate,
  },
  annotations: readOnly,
  handler: (args, { client }) => {
    const {
      group_by,
      per_page,
      cursor,
      label_id,
      release_id,
      isrc: i,
      upc: u,
      start_date,
      end_date,
    } = args;
    return client.get('/royalties/breakdown', {
      group_by,
      per_page,
      cursor,
      filter: { label_id, release_id, isrc: i, upc: u, start_date, end_date },
    });
  },
};

const listArtificialStreams: ToolDef = {
  name: 'list_artificial_streams',
  toolset: 'accounting',
  gate: 'read',
  title: 'List artificial-streaming records',
  description:
    'List the artificial-streaming records reported for your catalog, cursor-paginated — the per-record detail behind any artificial-streaming fee. Filter by dsp (spotify or apple), a start_date/end_date range, release_id, or isrc.',
  inputShape: {
    dsp: z.enum(['spotify', 'apple']).optional().describe('Filter by platform.'),
    start_date: startDate,
    end_date: endDate,
    release_id: releaseId,
    isrc,
    cursor: z.string().optional().describe('Pagination cursor.'),
    per_page: perPage,
  },
  annotations: readOnly,
  handler: (args, { client }) => {
    const { dsp, start_date, end_date, release_id, isrc: i, cursor, per_page } = args;
    return client.get('/royalties/artificial-streams', {
      dsp,
      start_date,
      end_date,
      release_id,
      isrc: i,
      cursor,
      per_page,
    });
  },
};

const getArtificialFeeBreakdown: ToolDef = {
  name: 'get_artificial_fee_breakdown',
  toolset: 'accounting',
  gate: 'read',
  title: 'Get artificial-streaming fee breakdown',
  description:
    'Retrieve the per-release breakdown of an artificial-streaming fee for one billing period. `period` is the month in YYYY-MM format.',
  inputShape: { period: z.string().describe('Billing month, YYYY-MM.') },
  annotations: readOnly,
  handler: (args, { client }) =>
    client.get(`/artificial-streaming-fee/${encodeURIComponent(String(args.period))}`),
};

const getAccountSummary: ToolDef = {
  name: 'get_account_summary',
  toolset: 'accounting',
  gate: 'read',
  title: 'Get account summary',
  description:
    'Retrieve your accounting summary — current balance and related account-level financial totals.',
  inputShape: {},
  annotations: readOnly,
  handler: (_args, { client }) => client.get('/account'),
};

export const accountingTools: ToolDef[] = [
  listStatements,
  getStatement,
  downloadStatementCsv,
  downloadStatementInvoice,
  listTransactions,
  getRoyaltiesBreakdown,
  listArtificialStreams,
  getArtificialFeeBreakdown,
  getAccountSummary,
];
