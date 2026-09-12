/**
 * The declarative tool contract every tool family produces, plus the
 * {@link ApiResult}-to-MCP result mapper.
 *
 * A tool is a plain data declaration — name, gate, zod input shape, client-hint
 * annotations and a one-call handler. The server module turns each declaration
 * into a registered MCP tool. This keeps every tool a thin wrapper: one HTTP
 * call, no client-side business logic.
 */

import type { ApiError, ApiResult, LabelGridClient } from '@labelgrid/core';
import type { z } from 'zod';
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
  /** Opted-in tools expose and validate this object contract through the SDK. */
  outputSchema?: z.AnyZodObject;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ApiResult<unknown>>;
};

export type ToolResult = {
  content: [{ type: 'text'; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: true;
};

/** Hard ceiling on the serialized text of a single tool result, in characters. */
const MAX_TOOL_TEXT = 400_000;

/** Maps an {@link ApiResult} to an MCP tool result: pretty JSON, error flagged. */
export function toToolResult(r: ApiResult<unknown>): ToolResult {
  if ('data' in r) {
    const text = JSON.stringify(r.data ?? null, null, 2);
    if (text.length > MAX_TOOL_TEXT) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: {
                  code: 'RESULT_TOO_LARGE',
                  message:
                    'Response exceeded the 400,000-character limit; response data was omitted.',
                  status: 0,
                  suggestion:
                    'Use pagination or filters to narrow reads. If this was a write, it may already have completed. Check its state before retrying.',
                },
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: 'text', text }] };
  }
  const errorText = JSON.stringify({ error: r.error }, null, 2);
  if (errorText.length <= MAX_TOOL_TEXT) {
    return { content: [{ type: 'text', text: errorText }], isError: true };
  }
  // Omit bulky API details first, preserving the diagnostic core when it fits.
  const bounded: ApiError = { ...r.error };
  if (bounded.errors !== undefined) bounded.errors = '[truncated]';
  if (bounded.errors_structured !== undefined) bounded.errors_structured = '[truncated]';
  if (bounded.details !== undefined) bounded.details = '[truncated]';
  const boundedText = JSON.stringify({ error: bounded }, null, 2);
  if (boundedText.length <= MAX_TOOL_TEXT) {
    return { content: [{ type: 'text', text: boundedText }], isError: true };
  }
  // Bound raw fields before encoding. Four string prefixes of at most 8,000 code units
  // leave room even when JSON escaping expands each code unit to six characters.
  const compact: ApiError = {
    code: boundDiagnostic(bounded.code),
    message: boundDiagnostic(bounded.message),
    status: bounded.status,
    field: bounded.field === undefined ? undefined : boundDiagnostic(bounded.field),
    suggestion: bounded.suggestion === undefined ? undefined : boundDiagnostic(bounded.suggestion),
    retry_after_seconds: bounded.retry_after_seconds,
    errors: bounded.errors,
    errors_structured: bounded.errors_structured,
    details: bounded.details,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: compact }, null, 2) }],
    isError: true,
  };
}

function boundDiagnostic(value: string): string {
  return value.length > 8_000 ? `${value.slice(0, 8_000)} [truncated]` : value;
}
