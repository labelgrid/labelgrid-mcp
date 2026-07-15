#!/usr/bin/env node
/**
 * Entrypoint: env → config → client → server → stdio.
 *
 * A configuration problem (missing token, etc.) prints an actionable message
 * to stderr and exits 1. Otherwise the server connects over the stdio
 * transport; stdout carries the MCP protocol only, all logging goes to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LabelGridClient } from './api/http.js';
import { type Config, ConfigError, loadConfig } from './config.js';
import { isToolEnabled } from './gating.js';
import { FULL_WRITES_NOTICE, LEGAL_SUMMARY } from './legal.js';
import { log } from './log.js';
import { buildServer } from './server.js';
import { accountingTools } from './tools/accounting.js';
import { analyticsTools } from './tools/analytics.js';
import { catalogReadTools } from './tools/catalog-read.js';
import { catalogWriteTools } from './tools/catalog-write.js';
import { deliveryTools } from './tools/delivery.js';
import { filesReadTools } from './tools/files-read.js';
import { fullWriteTools } from './tools/full-writes.js';
import { identityTools } from './tools/identity.js';
import { referenceTools } from './tools/reference.js';
import { releaseWriteTools } from './tools/release-write.js';
import { reviewReadTools } from './tools/review-read.js';
import type { ToolDef } from './tools/types.js';
import { webhookTools } from './tools/webhooks.js';
import { VERSION } from './version.js';

function allTools(): ToolDef[] {
  return [
    ...identityTools,
    ...referenceTools,
    ...analyticsTools,
    ...catalogReadTools,
    ...filesReadTools,
    ...reviewReadTools,
    ...deliveryTools,
    ...accountingTools,
    ...webhookTools,
    ...catalogWriteTools,
    ...releaseWriteTools,
    ...fullWriteTools,
  ];
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      log('error', err.message);
      process.exit(1);
    }
    throw err;
  }

  // In setup mode the token is null and never used; the placeholder keeps the
  // client type intact while no API calls are possible.
  const client = new LabelGridClient({
    baseUrl: config.baseUrl,
    token: config.token ?? '',
    version: VERSION,
  });

  if (config.setupMode) {
    const server = buildServer(config, client, []);
    log(
      'info',
      `labelgrid-mcp v${VERSION} — setup mode (no API token configured); call the "setup" tool for guided setup`,
    );
    log('info', LEGAL_SUMMARY);
    await server.connect(new StdioServerTransport());
    return;
  }

  const tools = allTools();
  const server = buildServer(config, client, tools);
  const enabled = tools.filter((t) => isToolEnabled(t, config)).length;

  log(
    'info',
    `labelgrid-mcp v${VERSION} — ${enabled} tools enabled (writes: ${config.writes ? 'on' : 'off'}, full-writes: ${config.fullWrites ? 'on' : 'off'})`,
  );
  log('info', LEGAL_SUMMARY);
  if (config.fullWrites) {
    log('warn', FULL_WRITES_NOTICE);
  }

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  log('error', 'fatal error starting labelgrid-mcp', {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
