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

import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  constants as fsConstants,
  linkSync,
  openSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
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
  if (!Number.isNaN(declared) && declared > max) {
    // Cancel the still-live body so the connection is released rather than held
    // open (the mid-stream path below cancels via the reader).
    await res.body?.cancel().catch(() => {});
    return tooLarge;
  }
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

/** True when `child` is `root` itself or nested beneath it (after realpath). */
function isWithin(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Validates that save_to_path is absolute and its parent resolves (via
 * realpathSync, so a dangling/symlinked parent is rejected) to an existing real
 * directory, AND — when an `allowedRoot` is given — that the resolved parent is
 * inside that allow-list root, so a tool can only write under a sanctioned
 * directory even if an injected path points elsewhere. The parent is resolved
 * to its real target BEFORE the prefix check (the file itself does not exist
 * yet), so a symlinked parent cannot escape the root. On success it RETURNS the
 * canonical write path — `join(realpath(parent), basename)` — so the caller
 * writes to the resolved location, not the caller-supplied path whose parent
 * symlink could be swapped between this check and the write (a TOCTOU escape).
 * Writing itself is exclusive (see writeNewFile), so this never overwrites an
 * existing file.
 */
function validateSavePath(
  p: string,
  allowedRoot: string | undefined,
): { canonicalPath: string } | ApiError {
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
  if (allowedRoot !== undefined && !isWithin(allowedRoot, realDir)) {
    return {
      code: 'DOWNLOAD_DIR_NOT_ALLOWED',
      message: `save_to_path must be inside the allowed download directory (${allowedRoot}). Set LABELGRID_DOWNLOAD_DIR to change it.`,
      status: 0,
    };
  }
  return { canonicalPath: join(realDir, basename(p)) };
}

/** Filesystem errors that mean "hardlinks are not supported here". */
const HARDLINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);

/** Best-effort removal of a temp file — a missing file is not an error. */
function unlinkSafe(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    // already gone / never created — nothing to clean up
  }
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
 * Streams a web response body to a NEW file, never overwriting an existing one
 * and never leaving a partial file at the destination. The body is streamed to
 * a temp sibling in the SAME directory (`<path>.partial-<pid>`, created 'wx'),
 * then atomically hard-linked into place — the link is both atomic AND exclusive
 * (EEXIST → FILE_EXISTS), so a transfer that fails mid-stream leaves NO file at
 * `path` and NO temp sibling behind. On a filesystem without hardlinks
 * (EPERM/ENOTSUP/EXDEV/…) it falls back to an exclusive copy (COPYFILE_EXCL).
 * Never buffers the whole body in memory.
 */
async function streamNewFile(
  path: string,
  body: ReadableStream<Uint8Array> | null,
): Promise<{ bytes: number } | ApiError> {
  if (body === null) {
    const err = writeNewFile(path, Buffer.alloc(0));
    return err ?? { bytes: 0 };
  }
  const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  const tmpResult = await streamToTempSibling(path, source);
  if ('code' in tmpResult) return tmpResult;
  return finalizeNewFile(tmpResult.tmp, path);
}

/**
 * Streams `source` into a temp sibling of `finalPath`, created exclusively
 * ('wx'). A collision with a stale temp (a dead process) is retried once with a
 * random suffix. On a mid-stream failure the partial temp is removed. Returns
 * the temp path, or a structured error.
 */
async function streamToTempSibling(
  finalPath: string,
  source: Readable,
): Promise<{ tmp: string } | ApiError> {
  const candidates = [
    `${finalPath}.partial-${process.pid}`,
    `${finalPath}.partial-${process.pid}-${randomBytes(6).toString('hex')}`,
  ];
  // Secure the temp fd BEFORE attaching the pipeline: pipeline() destroys its
  // streams on failure, so an open-time EEXIST (stale temp) must be resolved
  // without touching the source, or the retry would pipe a destroyed body.
  let tmp: string | undefined;
  let fd: number | undefined;
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      fd = openSync(candidate, 'wx', 0o600);
      tmp = candidate;
      break;
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return writeFailed(finalPath, err);
    }
  }
  if (tmp === undefined || fd === undefined) return writeFailed(finalPath, lastErr);
  const ws = createWriteStream(tmp, { fd }); // autoClose closes the fd either way
  try {
    await pipeline(source, ws);
    return { tmp };
  } catch (err) {
    unlinkSafe(tmp); // we created it, then the transfer failed — drop the partial
    return writeFailed(finalPath, err);
  }
}

/**
 * Moves a finished temp file into `path` exclusively: a hard link (atomic +
 * exclusive) with an exclusive-copy fallback where hardlinks are unavailable.
 * The temp is always removed. Returns the byte count or a structured error.
 */
function finalizeNewFile(tmp: string, path: string): { bytes: number } | ApiError {
  try {
    linkSync(tmp, path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      unlinkSafe(tmp);
      return fileExists(path);
    }
    if (code !== undefined && HARDLINK_UNSUPPORTED.has(code)) {
      // Non-atomic fallback for filesystems without hardlinks: a reader can see
      // the destination mid-copy (accepted for these rare filesystems), but an
      // interrupted copy must not LEAVE a partial destination — COPYFILE_EXCL
      // proved it did not pre-exist, so removing it on failure is safe.
      try {
        copyFileSync(tmp, path, fsConstants.COPYFILE_EXCL);
      } catch (copyErr) {
        unlinkSafe(tmp);
        if ((copyErr as NodeJS.ErrnoException).code === 'EEXIST') return fileExists(path);
        unlinkSafe(path);
        return writeFailed(path, copyErr);
      }
    } else {
      unlinkSafe(tmp);
      return writeFailed(path, err);
    }
  }
  unlinkSafe(tmp);
  return { bytes: statSync(path).size };
}

function fileExists(path: string): ApiError {
  return {
    code: 'FILE_EXISTS',
    message: `A file already exists at ${path}. This tool never overwrites — choose a new path.`,
    status: 0,
  };
}

function writeFailed(path: string, err: unknown): ApiError {
  return {
    code: 'WRITE_FAILED',
    message: `Could not write to ${path}: ${err instanceof Error ? err.message : 'unknown error'}.`,
    status: 0,
  };
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
  handler: async (args, { client, config }): Promise<ApiResult<unknown>> => {
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
      const validated = validateSavePath(savePath, config.downloadDir);
      if ('code' in validated) return { error: validated };
      const canonicalPath = validated.canonicalPath;
      const result = await client.getRaw(`/statements/${encodeURIComponent(invoice)}/invoice`);
      if (!result.ok) return { error: result.error };
      const written = await streamNewFile(canonicalPath, result.res.body);
      if ('code' in written) return { error: written };
      return { data: { saved_to: canonicalPath, bytes: written.bytes } };
    }

    // format === 'csv'
    let canonicalPath: string | undefined;
    if (savePath !== undefined) {
      const validated = validateSavePath(savePath, config.downloadDir);
      if ('code' in validated) return { error: validated };
      canonicalPath = validated.canonicalPath;
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
    if (canonicalPath !== undefined) {
      // Stream the export straight to disk — never buffer the whole CSV.
      const written = await streamNewFile(canonicalPath, result.res.body);
      if ('code' in written) return { error: written };
      return { data: { saved_to: canonicalPath, bytes: written.bytes } };
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
