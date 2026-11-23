import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, redactSecrets } from '../../src/log.js';

describe('redactSecrets', () => {
  it('masks the value of a top-level secret key', () => {
    const out = redactSecrets({ token: 'abc123', name: 'ok' }) as Record<string, unknown>;
    expect(out.token).toBe('***REDACTED***');
    expect(out.name).toBe('ok');
  });

  it('masks nested object secret keys and preserves non-secret values', () => {
    const out = redactSecrets({
      user: { password: 'hunter2', id: 7 },
      label: 'Example Records',
    }) as Record<string, Record<string, unknown>>;
    expect(out.user.password).toBe('***REDACTED***');
    expect(out.user.id).toBe(7);
    expect((out as Record<string, unknown>).label).toBe('Example Records');
  });

  it('masks secret keys inside arrays', () => {
    const out = redactSecrets([{ secret: 's' }, { safe: 1 }]) as Array<Record<string, unknown>>;
    expect(out[0].secret).toBe('***REDACTED***');
    expect(out[1].safe).toBe(1);
  });

  it('matches secret key names case-insensitively', () => {
    const out = redactSecrets({
      Authorization: 'Bearer x',
      API_Key: 'k',
      nonce: 'n',
    }) as Record<string, unknown>;
    expect(out.Authorization).toBe('***REDACTED***');
    expect(out.API_Key).toBe('***REDACTED***');
    expect(out.nonce).toBe('***REDACTED***');
  });

  it('masks URL- and link-valued keys, which can carry an access token', () => {
    const out = redactSecrets({
      release_link: 'https://preview.example.test/r/1?access=abc123',
      upload_url: 'https://storage.example.test/obj?X-Signature=s',
      config: { pre_order_links: ['https://store.example.test/p?ref=t'] },
      label_id: 3,
    }) as Record<string, unknown>;
    expect(out.release_link).toBe('***REDACTED***');
    expect(out.upload_url).toBe('***REDACTED***');
    expect((out.config as Record<string, unknown>).pre_order_links).toBe('***REDACTED***');
    expect(out.label_id).toBe(3);
  });

  it('replaces a URL inside any logged string, and keeps a boolean under a link key', () => {
    const out = redactSecrets({
      release_schedule: 'monthly, preview at https://preview.example.test/r/1?access=abc123 first',
      config: { links_page_enabled: true, custom_description: 'see http://x.example.test/a?t=1' },
      message: 'request to https://api.example.test/v1?sig=zz failed',
    }) as Record<string, unknown>;
    expect(out.release_schedule).toBe('monthly, preview at [url redacted] first');
    expect(JSON.stringify(out)).not.toContain('abc123');
    expect(JSON.stringify(out)).not.toContain('sig=zz');
    const config = out.config as Record<string, unknown>;
    expect(config.links_page_enabled).toBe(true);
    expect(config.custom_description).toBe('see [url redacted]');
  });

  it('returns primitives unchanged', () => {
    expect(redactSecrets('hello')).toBe('hello');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
  });
});

describe('log', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes to stderr and never to stdout', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    log('info', 'hello world');
    expect(err).toHaveBeenCalledTimes(1);
    expect(out).not.toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain('hello world');
  });

  it('redacts secret values in the meta before writing', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    log('warn', 'call', { token: 'super-secret-value', path: '/me' });
    const written = String(err.mock.calls[0][0]);
    expect(written).not.toContain('super-secret-value');
    expect(written).toContain('***REDACTED***');
    expect(written).toContain('/me');
  });
});
