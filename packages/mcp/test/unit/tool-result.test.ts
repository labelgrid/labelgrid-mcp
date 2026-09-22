import { describe, expect, it } from 'vitest';
import { toToolResult } from '../../src/tools/types.js';

describe('toToolResult', () => {
  it('passes small data through as pretty JSON', () => {
    const r = toToolResult({ data: { id: 1 } });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({ id: 1 });
  });

  it.each(['x', '"', '\\', '\n', '\u0000', '😀'])(
    'bounds oversized data containing %j',
    (character) => {
      const r = toToolResult({ data: { blob: character.repeat(500_000) } });
      expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
      expect(r.isError).toBe(true);
      expect(JSON.parse(r.content[0].text).error).toMatchObject({
        code: 'RESULT_TOO_LARGE',
        message: expect.stringContaining('omitted'),
        suggestion: expect.stringContaining('before retrying'),
      });
    },
  );

  it.each([399_999, 400_000, 400_001])(
    'checks the final serialized size at %i characters',
    (length) => {
      const data = 'x'.repeat(length - 2);
      const r = toToolResult({ data });
      expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
      if (length <= 400_000) {
        expect(r.isError).toBeUndefined();
        expect(JSON.parse(r.content[0].text)).toBe(data);
      } else {
        expect(r.isError).toBe(true);
        expect(JSON.parse(r.content[0].text).error.code).toBe('RESULT_TOO_LARGE');
      }
    },
  );

  it('preserves in-limit API diagnostics and retry guidance', () => {
    const error = {
      code: 'VALIDATION_FAILED',
      message: 'Invalid input',
      status: 422,
      field: 'title',
      suggestion: 'Fix the title.',
      retry_after_seconds: 30,
      errors: { title: ['Required'] },
      errors_structured: [{ field: 'title' }],
      details: { reason: 'Missing title' },
      blocking_issues: [{ id: 17, code: 'release_title_format' }],
    };
    const r = toToolResult({ error });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toEqual({ error });
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
        details: [{ context: 'w'.repeat(50_000) }],
        blocking_issues: [{ context: 'v'.repeat(50_000) }],
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
        details: unknown;
        blocking_issues: unknown;
      };
    };
    expect(parsed.error.code).toBe('VALIDATION_FAILED');
    expect(parsed.error.message).toBe('The submitted data was invalid.');
    expect(parsed.error.status).toBe(422);
    expect(parsed.error.suggestion).toBe('Fix the fields and retry.');
    expect(parsed.error.errors).toBe('[truncated]');
    expect(parsed.error.errors_structured).toBe('[truncated]');
    expect(parsed.error.details).toBe('[truncated]');
    expect(parsed.error.blocking_issues).toBe('[truncated]');
  });

  it('keeps an oversized details-only error as valid bounded JSON', () => {
    const r = toToolResult({
      error: {
        code: 'PROCESSING_ERROR',
        message: 'The delivery status could not be processed.',
        status: 500,
        details: [{ context: 'x'.repeat(500_000) }],
      },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
    const parsed = JSON.parse(r.content[0].text) as {
      error: { code: string; message: string; status: number; details: unknown };
    };
    expect(parsed.error).toEqual({
      code: 'PROCESSING_ERROR',
      message: 'The delivery status could not be processed.',
      status: 500,
      details: '[truncated]',
    });
  });

  it('hard-bounds an error whose own message exceeds the ceiling', () => {
    const r = toToolResult({
      error: {
        code: 'SERVER_ERROR',
        message: 'x'.repeat(500_000),
        status: 500,
      },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
    expect(JSON.parse(r.content[0].text).error).toMatchObject({
      code: 'SERVER_ERROR',
      status: 500,
      message: expect.stringMatching(/^x+.*\[truncated\]$/),
    });
  });

  it.each(['code', 'message', 'field', 'suggestion'] as const)(
    'bounds an escaped oversized %s',
    (field) => {
      const error = {
        code: 'SERVER_ERROR',
        message: 'Failed',
        status: 500,
        retry_after_seconds: 10,
        [field]: '\u0000"\\'.repeat(500_000),
      };
      const r = toToolResult({ error });
      expect(r.isError).toBe(true);
      expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
      const parsed = JSON.parse(r.content[0].text).error;
      expect(parsed.status).toBe(500);
      expect(parsed.retry_after_seconds).toBe(10);
      expect(parsed[field]).toContain('[truncated]');
    },
  );

  it('bounds all diagnostic fields even with worst-case JSON escaping', () => {
    const huge = '\u0000'.repeat(500_000);
    const r = toToolResult({
      error: {
        code: huge,
        message: huge,
        status: 429,
        field: huge,
        suggestion: huge,
        errors: huge,
        errors_structured: huge,
        details: huge,
        blocking_issues: huge,
        retry_after_seconds: 60,
      },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text.length).toBeLessThanOrEqual(400_000);
    const parsed = JSON.parse(r.content[0].text).error;
    expect(parsed.status).toBe(429);
    expect(parsed.retry_after_seconds).toBe(60);
    for (const field of [
      'code',
      'message',
      'field',
      'suggestion',
      'errors',
      'errors_structured',
      'details',
      'blocking_issues',
    ]) {
      expect(parsed[field]).toContain('[truncated]');
    }
  });
});
