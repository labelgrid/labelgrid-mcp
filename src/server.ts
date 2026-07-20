/**
 * MCP server construction and gated tool registration.
 *
 * Only tools that pass {@link isToolEnabled} are registered. Each handler is
 * wrapped so it: (1) re-checks its gate at call time (defense in depth — the
 * registration filter is the first line), (2) runs the one-call handler, (3)
 * logs the tool name, redacted args and duration to stderr, and (4) shapes the
 * result via {@link toToolResult} (API errors become isError results, never
 * protocol errors).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiResult, LabelGridClient } from './api/http.js';
import { type Config, defaultExcludedToolsets } from './config.js';
import { isToolEnabled } from './gating.js';
import { DATA_HANDLING_NOTE, FULL_WRITES_NOTICE, LEGAL_SUMMARY } from './legal.js';
import { log } from './log.js';
import { registerReferenceResources } from './resources.js';
import { setupTools } from './tools/setup.js';
import { type ToolDef, toToolResult } from './tools/types.js';
import { VERSION } from './version.js';

/**
 * The MCP-native disclosure channel: a concise usage + legal text delivered in
 * the initialize result's `instructions` field, which clients surface to users.
 * In setup mode it points the client at the `setup` tool instead.
 */
function buildInstructions(config: Config): string {
  if (config.setupMode) {
    return [
      'No LabelGrid API token is configured, so the account is not connected yet. ' +
        'Call the `setup` tool for step-by-step instructions to connect. The full ' +
        'tool catalog is listed so you can see what the server offers, but no ' +
        'account data can be accessed in this state — every tool returns setup ' +
        'guidance until a token is configured.',
      LEGAL_SUMMARY,
    ].join('\n\n');
  }
  const parts = [
    'Official LabelGrid MCP server — your AI client can read and manage this LabelGrid ' +
      'account via the public API.',
    LEGAL_SUMMARY,
    DATA_HANDLING_NOTE,
  ];
  if (config.fullWrites) parts.push(FULL_WRITES_NOTICE);
  return parts.join('\n\n');
}

export function buildServer(config: Config, client: LabelGridClient, tools: ToolDef[]): McpServer {
  const server = new McpServer(
    { name: 'labelgrid-mcp', version: VERSION },
    { instructions: buildInstructions(config) },
  );

  // In setup mode the setup helper leads, and the full catalog stays LISTED so
  // introspection shows what the server offers — but every catalog tool is
  // inert: without a token no API call is possible, so invoking one returns
  // setup guidance instead of executing.
  const registered = config.setupMode ? [...setupTools, ...tools] : tools;

  for (const tool of registered) {
    const isSetupHelper = tool.toolset === 'setup';
    // Listing rule: connected mode applies the full gate matrix; setup mode
    // lists the whole catalog (honoring an explicit toolset narrowing, and
    // otherwise the same default exclusion the connected surface applies — so
    // the advertised surface matches reality), because nothing can execute
    // without a token anyway.
    const listable = config.setupMode
      ? config.toolsets === null
        ? !defaultExcludedToolsets.has(tool.toolset)
        : config.toolsets.has(tool.toolset)
      : isToolEnabled(tool, config);
    if (!isSetupHelper && !listable) continue;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        // Not connected: every catalog tool refuses with setup guidance.
        if (config.setupMode && !isSetupHelper) {
          return toToolResult({
            error: {
              code: 'NOT_CONNECTED',
              message:
                'No LabelGrid API token is configured, so this tool cannot run yet. ' +
                'Call the `setup` tool for step-by-step instructions to connect your account.',
              status: 0,
            },
          }) as CallToolResult;
        }
        // Defense in depth: even a registered tool re-verifies its gate.
        if (!isSetupHelper && !isToolEnabled(tool, config)) {
          return toToolResult({
            error: {
              code: 'TOOL_DISABLED',
              message: `Tool "${tool.name}" is not enabled in the current configuration.`,
              status: 0,
            },
          }) as CallToolResult;
        }
        const startedAt = Date.now();
        let result: ApiResult<unknown>;
        try {
          result = await tool.handler(args ?? {}, { client, config });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
          log('error', `tool ${tool.name} threw`, { message });
          return toToolResult({
            error: { code: 'UNEXPECTED_ERROR', message, status: 0 },
          }) as CallToolResult;
        }
        log('info', `tool ${tool.name}`, { args: args ?? {}, duration_ms: Date.now() - startedAt });
        return toToolResult(result) as CallToolResult;
      },
    );
  }

  // The nine labelgrid://reference/{type} resources are registered in every
  // mode; in setup mode their reads return NOT_CONNECTED guidance.
  registerReferenceResources(server, config, client);

  return server;
}
