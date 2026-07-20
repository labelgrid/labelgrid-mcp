#!/usr/bin/env node
/** The `labelgrid` bin entry: run the CLI and exit with its code. */

import { scrubErrorMessage } from './errors.js';
import { runCli } from './program.js';

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`UNEXPECTED_ERROR: ${scrubErrorMessage(message)}\n`);
    process.exitCode = 1;
  },
);
