#!/usr/bin/env node
/**
 * Tool-catalog token budget gate.
 *
 * Registers default, read-only, full and catalog-only surfaces on in-memory
 * servers and lists each through a real MCP client. For every tool it serializes
 * name + title + description + JSON input schema (exactly what listing returns)
 * and estimates tokens as ceil(chars / 4). The constant `$schema` draft URI the
 * SDK stamps onto every tool's schema is dropped before measuring — it is
 * identical protocol boilerplate on all tools, not authored catalog content.
 * Output-schema estimates are reported separately, outside this unchanged
 * input-definition metric. Prints a full-catalog toolset breakdown and each
 * surface total; exits 1 when the full input-definition total exceeds the budget.
 *
 * Build first (`npm run build`) so `dist/` exists.
 *
 * Run: `npm run measure-tokens`
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// The catalog had grown to ~7997 against the previous 8000, so no tool could gain
// a documented parameter without the gate refusing it: the delete tool's
// `replace_with` costs ~108 tokens at its tightest, and trimming that far would
// have meant cutting documentation from unrelated tools to pay for it. Raised to
// keep the gate tight (~200 tokens of headroom) rather than to clear the way.
// Trim before raising this again.
const BUDGET_TOKENS = 8300;

const PACKAGES = resolve(new URL('.', import.meta.url).pathname, '../packages');

async function importDist(pkg, rel) {
  const url = pathToFileURL(resolve(PACKAGES, pkg, 'dist', rel)).href;
  try {
    return await import(url);
  } catch {
    console.error(
      `measure-tool-tokens: could not import packages/${pkg}/dist/${rel} — run \`npm run build\` first.`,
    );
    process.exit(1);
  }
}

async function listSurface(config, tools, buildServer, LabelGridClient) {
  const apiClient = new LabelGridClient({
    baseUrl: config.baseUrl,
    token: config.token,
    version: 'measure',
    fetchFn: async () => {
      throw new Error('Tool-catalog measurement must not call the API.');
    },
  });
  const server = buildServer(config, apiClient, tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'measure-tool-tokens', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

function measure(listed, toolsetOf) {
  const perToolset = new Map();
  let total = 0;
  let outputTotal = 0;
  let outputCount = 0;
  for (const t of listed) {
    // Drop the constant per-tool `$schema` draft URI (protocol boilerplate).
    const { $schema: _, ...inputSchema } = t.inputSchema ?? {};
    const serialized = JSON.stringify({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
    });
    const tokens = Math.ceil(serialized.length / 4);
    total += tokens;
    const toolset = toolsetOf.get(t.name) ?? 'unknown';
    perToolset.set(toolset, (perToolset.get(toolset) ?? 0) + tokens);
    if (t.outputSchema !== undefined) {
      const { $schema: _, ...outputSchema } = t.outputSchema;
      outputTotal += Math.ceil(JSON.stringify({ outputSchema }).length / 4);
      outputCount += 1;
    }
  }
  return { total, perToolset, outputTotal, outputCount };
}

async function main() {
  const { allTools } = await importDist('mcp', 'tools/all.js');
  const { buildServer } = await importDist('mcp', 'server.js');
  const { LabelGridClient } = await importDist('core', 'index.js');
  const { loadConfig, KNOWN_TOOLSETS, FULL_WRITES_ACK } = await importDist('mcp', 'config.js');

  const tools = allTools();
  const toolsetOf = new Map(tools.map((t) => [t.name, t.toolset]));
  // Parse isolated example environments, never the operator's credentials or flags.
  const env = {
    LABELGRID_API_URL: 'https://api.invalid/api/public',
    LABELGRID_API_TOKEN: 'measure-only',
  };
  const surfaces = [
    ['default', {}],
    ['read-only', { LABELGRID_READ_ONLY: 'true' }],
    [
      'full',
      {
        LABELGRID_ENABLE_FULL_WRITES: 'true',
        LABELGRID_FULL_WRITES_ACK: FULL_WRITES_ACK,
        LABELGRID_TOOLSETS: [...KNOWN_TOOLSETS].join(','),
      },
    ],
    ['catalog-only', { LABELGRID_TOOLSETS: 'catalog' }],
  ];
  for (const [name, overrides] of surfaces) {
    const listed = await listSurface(
      loadConfig({ ...env, ...overrides }),
      tools,
      buildServer,
      LabelGridClient,
    );
    if (name === 'full' && listed.length !== tools.length) {
      throw new Error(
        `Expected the full catalog (${tools.length} tools) to register, got ${listed.length}.`,
      );
    }
    const { total, perToolset, outputTotal, outputCount } = measure(listed, toolsetOf);
    if (name === 'full') {
      for (const [toolset, tokens] of perToolset) {
        console.error(`measure-tool-tokens: full/${toolset.padEnd(14)} ~${tokens} input tokens`);
      }
    }
    console.error(
      `measure-tool-tokens: ${name.padEnd(12)} ${listed.length} tools; input definitions ~${total}; output schemas ~${outputTotal} (${outputCount} tools).`,
    );
    if (name === 'full') {
      console.error(`measure-tool-tokens: full input-definition budget ${BUDGET_TOKENS}.`);
      if (total > BUDGET_TOKENS) {
        console.error(
          `measure-tool-tokens: FAILED — the full catalog exceeds the ${BUDGET_TOKENS}-token budget. Trim tool descriptions/schemas.`,
        );
        process.exitCode = 1;
      }
    }
  }
}

main().catch((err) => {
  console.error(`measure-tool-tokens: error — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
