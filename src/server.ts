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
import type { Config } from './config.js';
import { isToolEnabled } from './gating.js';
import { DATA_HANDLING_NOTE, FULL_WRITES_NOTICE, LEGAL_SUMMARY } from './legal.js';
import { log } from './log.js';
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
        'Call the `setup` tool for step-by-step instructions to connect. No account ' +
        'data can be accessed in this state.',
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

  // In setup mode ONLY the setup helper is registered — the account is not
  // connected, so none of the API-backed tools are exposed.
  const registered = config.setupMode ? setupTools : tools;

  for (const tool of registered) {
    if (!isToolEnabled(tool, config)) continue;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        // Defense in depth: even a registered tool re-verifies its gate.
        if (!isToolEnabled(tool, config)) {
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

  return server;
}
