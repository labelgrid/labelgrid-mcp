#!/usr/bin/env node
/**
 * Tool-catalog token budget gate.
 *
 * Registers the FULL compiled catalog (every toolset, full writes armed) on an
 * in-memory server, lists it through a real MCP client, and estimates the
 * context cost a client pays to hold the catalog: for every tool it serializes
 * name + title + description + JSON input schema (exactly what listing returns)
 * and estimates tokens as ceil(chars / 4). The constant `$schema` draft URI the
 * SDK stamps onto every tool's schema is dropped before measuring — it is
 * identical protocol boilerplate on all tools, not authored catalog content.
 * Prints a per-toolset breakdown and the total; exits 1 when the full catalog
 * exceeds the budget.
 *
 * Build first (`npm run build`) so `dist/` exists.
 *
 * Run: `npm run measure-tokens`
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const BUDGET_TOKENS = 8000;

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

async function main() {
  const { allTools } = await importDist('mcp', 'tools/all.js');
  const { buildServer } = await importDist('mcp', 'server.js');
  const { LabelGridClient } = await importDist('core', 'index.js');
  const { KNOWN_TOOLSETS } = await importDist('mcp', 'config.js');

  const tools = allTools();
  // Full catalog: every toolset selected explicitly (so default-off toolsets
  // register too) and every gate armed.
  const config = {
    baseUrl: 'https://api.invalid/api/public',
    token: 'measure-only',
    setupMode: false,
    writes: true,
    fullWrites: true,
    toolsets: new Set(KNOWN_TOOLSETS),
  };
  const apiClient = new LabelGridClient({
    baseUrl: config.baseUrl,
    token: config.token,
    version: 'measure',
  });
  const server = buildServer(config, apiClient, tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'measure-tool-tokens', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = (await client.listTools()).tools;
  await client.close();

  if (listed.length !== tools.length) {
    console.error(
      `measure-tool-tokens: expected the full catalog (${tools.length} tools) to register, got ${listed.length}.`,
    );
    process.exit(1);
  }

  const toolsetOf = new Map(tools.map((t) => [t.name, t.toolset]));
  const perToolset = new Map();
  let total = 0;
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
  }

  for (const [toolset, tokens] of perToolset) {
    console.error(`measure-tool-tokens: ${toolset.padEnd(14)} ~${tokens} tokens`);
  }
  console.error(
    `measure-tool-tokens: TOTAL ~${total} estimated tokens for ${listed.length} tools (budget ${BUDGET_TOKENS}).`,
  );
  if (total > BUDGET_TOKENS) {
    console.error(
      `measure-tool-tokens: FAILED — the full catalog exceeds the ${BUDGET_TOKENS}-token budget. Trim tool descriptions/schemas.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`measure-tool-tokens: error — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
