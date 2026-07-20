/**
 * Download write discipline — the same rules as the server-side statement
 * download: `--out` must be an absolute path whose parent directory resolves
 * (via realpath, so a dangling symlink parent is rejected) to a real
 * directory, and the write is wx-exclusive so an existing file is NEVER
 * overwritten — unless the user passes `--force`.
 */

import { realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
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
