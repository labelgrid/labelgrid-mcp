/**
 * Download write discipline — the same rules as the server-side statement
 * download: `--out` must be an absolute path whose parent directory resolves
 * (via realpath, so a dangling symlink parent is rejected) to a real
 * directory, and the write is wx-exclusive so an existing file is NEVER
 * overwritten — unless the user passes `--force`.
 */

import { createWriteStream, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApiError } from '@labelgrid/core';

/** Validates an --out path. Returns a structured error, or null when valid. */
export function validateOutPath(p: string): ApiError | null {
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
  return null;
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

/**
 * Streams a web response body straight to disk, never buffering the whole file
 * in memory. Applies the same write discipline as {@link writeDownload}: without
 * `force` the file is opened exclusively ('wx') and an existing path returns
 * FILE_EXISTS; with `force` it is overwritten. Returns the bytes written on
 * success, or a structured error. `onProgress` (when given) is called with the
 * running byte count as chunks arrive.
 */
export async function streamDownload(
  path: string,
  body: ReadableStream<Uint8Array> | null,
  force: boolean,
  onProgress?: (bytesSoFar: number) => void,
): Promise<{ bytes: number } | { error: ApiError }> {
  if (body === null) {
    // No body to stream (e.g. an empty response) — write an empty file with the
    // same exclusive-create discipline.
    const err = writeDownload(path, Buffer.alloc(0), force);
    return err ? { error: err } : { bytes: 0 };
  }
  const ws = createWriteStream(path, { flags: force ? 'w' : 'wx' });
  let bytes = 0;
  let source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  if (onProgress !== undefined) {
    source = source.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      onProgress(bytes);
    });
  }
  try {
    await pipeline(source, ws);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        error: {
          code: 'FILE_EXISTS',
          message: `A file already exists at ${path}. Pass --force to overwrite, or choose a new path.`,
          status: 0,
        },
      };
    }
    return {
      error: {
        code: 'WRITE_FAILED',
        message: `Could not write to ${path}: ${err instanceof Error ? err.message : 'unknown error'}.`,
        status: 0,
      },
    };
  }
  // When no progress listener counted them, read the final size back off disk.
  if (onProgress === undefined) bytes = statSync(path).size;
  return { bytes };
}
