/**
 * The declarative tool contract every tool family produces, plus the
 * {@link ApiResult}-to-MCP result mapper.
 *
 * A tool is a plain data declaration — name, gate, zod input shape, client-hint
 * annotations and a one-call handler. The server module turns each declaration
 * into a registered MCP tool. This keeps every tool a thin wrapper: one HTTP
 * call, no client-side business logic.
 */

import type { z } from 'zod';
import type { ApiError, ApiResult, LabelGridClient } from '../api/http.js';
import type { Config } from '../config.js';
import type { Gate } from '../gating.js';

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

export type ToolContext = { client: LabelGridClient; config: Config };

export type ToolDef = {
  name: string;
  toolset: string;
  gate: Gate;
  title: string;
  description: string;
  inputShape: z.ZodRawShape;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ApiResult<unknown>>;
};

export type ToolResult = {
  content: [{ type: 'text'; text: string }];
  isError?: true;
};

/** Hard ceiling on the serialized text of a single tool result, in characters. */
const MAX_TOOL_TEXT = 400_000;

/** Maps an {@link ApiResult} to an MCP tool result: pretty JSON, error flagged. */
export function toToolResult(r: ApiResult<unknown>): ToolResult {
  if ('data' in r) {
    const text = JSON.stringify(r.data ?? null, null, 2);
    if (text.length > MAX_TOOL_TEXT) {
      // Reserve headroom for the wrapper keys so the whole envelope, not just the
      // prefix, stays under the ceiling.
      const wrapped = JSON.stringify(
        {
          truncated: true,
          note: 'Response truncated — use pagination or filters to narrow the request.',
          data_prefix: text.slice(0, MAX_TOOL_TEXT - 1_000),
        },
        null,
        2,
      );
      return { content: [{ type: 'text', text: wrapped }] };
    }
    return { content: [{ type: 'text', text }] };
  }
  const errorText = JSON.stringify({ error: r.error }, null, 2);
  if (errorText.length <= MAX_TOOL_TEXT) {
    return { content: [{ type: 'text', text: errorText }], isError: true };
  }
  // The only unbounded fields are the verbatim API passthroughs; drop them so the
  // envelope stays under the ceiling while the diagnostic core (code/message/
  // status/suggestion) survives intact.
  const bounded: ApiError = { ...r.error };
  if (bounded.errors !== undefined) bounded.errors = '[truncated]';
  if (bounded.errors_structured !== undefined) bounded.errors_structured = '[truncated]';
  const boundedText = JSON.stringify({ error: bounded }, null, 2);
  if (boundedText.length <= MAX_TOOL_TEXT) {
    return { content: [{ type: 'text', text: boundedText }], isError: true };
  }
  // Even after dropping the passthroughs the envelope is over the ceiling — a
  // hostile error whose own code/message is huge. Hard-slice the serialized text
  // at MAX_TOOL_TEXT and return it as-is: the result is no longer valid JSON, but
  // an over-limit hostile error forfeits pretty structure to keep the hard bound.
  return {
    content: [{ type: 'text', text: boundedText.slice(0, MAX_TOOL_TEXT) }],
    isError: true,
  };
}
