/**
 * Download write discipline — the same rules as the server-side statement
 * download: `--out` must be an absolute path whose parent directory resolves
 * (via realpath, so a dangling symlink parent is rejected) to a real
 * directory, and the write is wx-exclusive so an existing file is NEVER
 * overwritten — unless the user passes `--force`.
 */

import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  constants as fsConstants,
  linkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApiError } from '@labelgrid/core';

/**
 * Validates an --out path. On success RETURNS the canonical write path —
 * `join(realpath(parent), basename)` — so the caller writes to the resolved
 * location, not the caller-supplied path whose parent symlink could be swapped
 * between this check and the write (a TOCTOU escape).
 */
export function validateOutPath(p: string): { canonicalPath: string } | ApiError {
  if (!isAbsolute(p)) {
    return {
      code: 'INVALID_PATH',
      message: `--out must be an absolute path (received: ${p}).`,
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
      message: `The parent directory of --out does not exist: ${dir}.`,
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
      message: `The parent directory of --out is not a directory: ${dir}.`,
      status: 0,
    };
  }
  return { canonicalPath: join(realDir, basename(p)) };
}

/**
 * Writes the file. Without `force` the write is exclusive ('wx') and an
 * existing path returns FILE_EXISTS; with `force` an existing file is
 * overwritten. Returns a structured error, or null on success.
 */
export function writeDownload(
  path: string,
  data: string | Buffer,
  force: boolean,
): ApiError | null {
  try {
    writeFileSync(path, data, { flag: force ? 'w' : 'wx' });
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        code: 'FILE_EXISTS',
        message: `A file already exists at ${path}. Pass --force to overwrite, or choose a new path.`,
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

function fileExistsError(path: string): ApiError {
  return {
    code: 'FILE_EXISTS',
    message: `A file already exists at ${path}. Pass --force to overwrite, or choose a new path.`,
    status: 0,
  };
}

function writeFailedError(path: string, err: unknown): ApiError {
  return {
    code: 'WRITE_FAILED',
    message: `Could not write to ${path}: ${err instanceof Error ? err.message : 'unknown error'}.`,
    status: 0,
  };
}

/**
 * Streams a web response body to disk WITHOUT ever truncating an existing file
 * before the transfer succeeds and WITHOUT leaving a partial file behind. The
 * body is streamed to a temp sibling in the SAME directory
 * (`<path>.partial-<pid>`, created 'wx'), then moved into place atomically:
 *   - without `force`: a hard link (atomic AND exclusive — EEXIST → FILE_EXISTS),
 *     with an exclusive-copy fallback where hardlinks are unavailable;
 *   - with `force`: a rename (atomic replace — the existing file survives
 *     untouched until the transfer succeeds).
 * On ANY failure the temp sibling is removed. Never buffers the whole file in
 * memory. `onProgress` (when given) is called with the running byte count.
 */
export async function streamDownload(
  path: string,
  body: ReadableStream<Uint8Array> | null,
  force: boolean,
  onProgress?: (bytesSoFar: number) => void,
): Promise<{ bytes: number } | { error: ApiError }> {
  if (body === null) {
    // No body to stream (e.g. an empty response) — write an empty file with the
    // same exclusive-create discipline (force replaces atomically at zero bytes).
    const err = writeDownload(path, Buffer.alloc(0), force);
    return err ? { error: err } : { bytes: 0 };
  }
  let source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  let counted = 0;
  if (onProgress !== undefined) {
    source = source.on('data', (chunk: Buffer) => {
      counted += chunk.length;
      onProgress(counted);
    });
  }
  const tmpResult = await streamToTempSibling(path, source);
  if ('error' in tmpResult) return tmpResult;
  const moved = finalizeDownload(tmpResult.tmp, path, force);
  return 'error' in moved ? moved : { bytes: moved.bytes };
}

/**
 * Streams `source` into a temp sibling of `finalPath`, created exclusively
 * ('wx'). A collision with a stale temp (a dead process) is retried once with a
 * random suffix. On a mid-stream failure the partial temp is removed.
 */
async function streamToTempSibling(
  finalPath: string,
  source: Readable,
): Promise<{ tmp: string } | { error: ApiError }> {
  const candidates = [
    `${finalPath}.partial-${process.pid}`,
    `${finalPath}.partial-${process.pid}-${randomBytes(6).toString('hex')}`,
  ];
  let lastErr: unknown;
  for (const tmp of candidates) {
    const ws = createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
    try {
      await pipeline(source, ws);
      return { tmp };
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue; // stale temp, not ours
      unlinkSafe(tmp); // we created it, then the transfer failed — drop the partial
      return { error: writeFailedError(finalPath, err) };
    }
  }
  return { error: writeFailedError(finalPath, lastErr) };
}

/**
 * Moves a finished temp file into `path`. With `force` it is an atomic rename
 * (replaces any existing file only after the transfer succeeded). Without
 * `force` it is an exclusive hard link (EEXIST → FILE_EXISTS) with an
 * exclusive-copy fallback where hardlinks are unavailable. The temp is always
 * removed.
 */
function finalizeDownload(
  tmp: string,
  path: string,
  force: boolean,
): { bytes: number } | { error: ApiError } {
  try {
    if (force) {
      renameSync(tmp, path);
      return { bytes: statSync(path).size };
    }
    try {
      linkSync(tmp, path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        unlinkSafe(tmp);
        return { error: fileExistsError(path) };
      }
      if (code !== undefined && HARDLINK_UNSUPPORTED.has(code)) {
        try {
          copyFileSync(tmp, path, fsConstants.COPYFILE_EXCL);
        } catch (copyErr) {
          unlinkSafe(tmp);
          if ((copyErr as NodeJS.ErrnoException).code === 'EEXIST') {
            return { error: fileExistsError(path) };
          }
          return { error: writeFailedError(path, copyErr) };
        }
      } else {
        unlinkSafe(tmp);
        return { error: writeFailedError(path, err) };
      }
    }
    unlinkSafe(tmp);
    return { bytes: statSync(path).size };
  } catch (err) {
    unlinkSafe(tmp);
    return { error: writeFailedError(path, err) };
  }
}
