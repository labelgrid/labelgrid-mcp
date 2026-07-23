/**
 * Test harness: runs the REAL command wiring (runCli) against a recording stub
 * core client, an in-memory token store, buffered output sinks and a scripted
 * confirmation line — no live network, no real credential store.
 */

import type { ApiResult } from '@labelgrid/core';
import type { CliClient, ClientOpts } from '../src/context.js';
import type { TokenStore } from '../src/credentials.js';
import { runCli } from '../src/program.js';

export const TEST_TOKEN = 'tok-test-value-abc123';

export class Buf {
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
}

export type Call = { method: string; args: unknown[] };

export type StubCfg = {
  /** The result every JSON-path method returns (default { data: { ok: true } }). */
  result?: ApiResult<unknown>;
  /** Per-call override: return undefined to fall back to `result`. */
  resultFor?: (method: string, path: string) => ApiResult<unknown> | undefined;
  /** Response factory for client.raw (default an empty 200). */
  rawResponse?: (url: string) => Response;
};

export function makeStubClient(cfg: StubCfg = {}): { client: CliClient; calls: Call[] } {
  const calls: Call[] = [];
  const fallback: ApiResult<unknown> = cfg.result ?? { data: { ok: true } };
  const pick = (method: string, path: string): ApiResult<unknown> =>
    cfg.resultFor?.(method, path) ?? fallback;
  const record = (method: string, args: unknown[]): ApiResult<unknown> => {
    calls.push({ method, args });
    return pick(method, String(args[0]));
  };
  const client = {
    get: async (path: string, query?: Record<string, unknown>) => record('get', [path, query]),
    post: async (path: string, body?: unknown, opts?: unknown) =>
      record('post', [path, body, opts]),
    patch: async (path: string, body?: unknown) => record('patch', [path, body]),
    put: async (path: string, body?: unknown, opts?: unknown) => record('put', [path, body, opts]),
    delete: async (path: string) => record('delete', [path]),
    postMultipart: async (
      path: string,
      filePath: string,
      fieldName: string,
      extra?: Record<string, string>,
    ) => record('postMultipart', [path, filePath, fieldName, extra]),
    raw: async (url: string, init: RequestInit) => {
      calls.push({ method: 'raw', args: [url, init] });
      // Real fetch consumes the request body; drain a stream body to completion
      // so an upload's read stream is not left orphaned (an unconsumed stream
      // would open/read after the test's temp files are cleaned up and throw).
      const body = init.body as AsyncIterable<unknown> | null;
      if (
        body != null &&
        typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
      ) {
        for await (const _chunk of body) {
          // discard — only draining
        }
      }
      return cfg.rawResponse?.(url) ?? new Response(null, { status: 200 });
    },
  };
  return { client: client as unknown as CliClient, calls };
}

export function memoryStore(initial: string | null = null): TokenStore & {
  readonly token: string | null;
} {
  let token = initial;
  return {
    save(t: string): string {
      token = t;
      return 'memory store';
    },
    load(): string | null {
      return token;
    },
    clear(): boolean {
      const had = token !== null;
      token = null;
      return had;
    },
    describe(): string {
      return 'memory store';
    },
    get token(): string | null {
      return token;
    },
  };
}

export type RunOpts = {
  env?: NodeJS.ProcessEnv;
  store?: TokenStore;
  /** The line returned by readLine (confirmation prompts / auth login input). */
  answer?: string;
  stub?: { client: CliClient; calls: Call[] };
  clientCfg?: StubCfg;
  /** Whether stdin is treated as an interactive terminal (default false). */
  stdinIsTTY?: boolean;
  /** The hidden-input reader used on the TTY login path. */
  readSecret?: () => Promise<string>;
  /** Overrides client construction (e.g. to throw an unexpected error). */
  createClient?: (opts: ClientOpts) => CliClient;
};

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  calls: Call[];
  /** Every createClient invocation (token + baseUrl actually used). */
  clientOpts: ClientOpts[];
  store: TokenStore;
};

export async function run(argv: string[], opts: RunOpts = {}): Promise<RunResult> {
  const stdout = new Buf();
  const stderr = new Buf();
  const stub = opts.stub ?? makeStubClient(opts.clientCfg);
  const store = opts.store ?? memoryStore();
  const clientOpts: ClientOpts[] = [];
  const code = await runCli(argv, {
    env: opts.env ?? { LABELGRID_API_TOKEN: TEST_TOKEN },
    stdout,
    stderr,
    tokenStore: store,
    createClient: (o) => {
      clientOpts.push(o);
      if (opts.createClient !== undefined) return opts.createClient(o);
      return stub.client;
    },
    readLine: async () => opts.answer ?? '',
    // Default to non-TTY so tests never touch the real terminal; opt in per test.
    stdinIsTTY: opts.stdinIsTTY ?? false,
    readSecret: opts.readSecret ?? (async () => opts.answer ?? ''),
  });
  return { code, stdout: stdout.text, stderr: stderr.text, calls: stub.calls, clientOpts, store };
}
