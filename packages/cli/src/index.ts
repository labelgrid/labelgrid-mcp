#!/usr/bin/env node
/** The `labelgrid` bin entry: run the CLI and exit with its code. */

import { runCli } from './program.js';

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`UNEXPECTED_ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
