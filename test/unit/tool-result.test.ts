import { describe, expect, it } from 'vitest';
import { toToolResult } from '../../src/tools/types.js';

describe('toToolResult', () => {
  it('passes small data through as pretty JSON', () => {
    const r = toToolResult({ data: { id: 1 } });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({ id: 1 });
  });

  it('caps oversized data with a truncation wrapper under the ceiling', () => {
    const big = { blob: 'x'.repeat(500_000) };
    const r = toToolResult({ data: big });
    const parsed = JSON.parse(r.content[0].text) as {
      truncated: boolean;
      note: string;
      data_prefix: string;
    };
    expect(parsed.truncated).toBe(true);
    expect(parsed.note).toContain('truncated');
    // Headroom is reserved for the wrapper keys so the whole envelope stays under 400k.
    expect(parsed.data_prefix.length).toBe(399_000);
    expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
    expect(r.isError).toBeUndefined();
  });

  it('flags an error result with isError', () => {
    const r = toToolResult({ error: { code: 'X', message: 'boom', status: 400 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('boom');
  });

  it('bounds an oversized error by truncating passthrough fields, keeping the core', () => {
    const r = toToolResult({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The submitted data was invalid.',
        status: 422,
        suggestion: 'Fix the fields and retry.',
        errors: { field: ['y'.repeat(500_000)] },
        errors_structured: [{ field: 'field', detail: 'z'.repeat(50_000) }],
      },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
    const parsed = JSON.parse(r.content[0].text) as {
      error: {
        code: string;
        message: string;
        status: number;
        suggestion: string;
        errors: unknown;
        errors_structured: unknown;
      };
    };
    expect(parsed.error.code).toBe('VALIDATION_FAILED');
    expect(parsed.error.message).toBe('The submitted data was invalid.');
    expect(parsed.error.status).toBe(422);
    expect(parsed.error.suggestion).toBe('Fix the fields and retry.');
    expect(parsed.error.errors).toBe('[truncated]');
    expect(parsed.error.errors_structured).toBe('[truncated]');
  });

  it('hard-bounds an error whose own message exceeds the ceiling', () => {
    // Nothing to drop here (no passthroughs) — the message itself is over-limit,
    // so the envelope is hard-sliced at the ceiling and returned as-is.
    const r = toToolResult({
      error: {
        code: 'SERVER_ERROR',
        message: 'x'.repeat(500_000),
        status: 500,
      },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
  });
});
