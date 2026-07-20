import { describe, expect, it } from 'vitest';
import { run } from '../helpers.js';

describe('release lifecycle commands', () => {
  it('validate posts to the validate endpoint without any confirmation', async () => {
    const r = await run(['release', 'validate', '12']);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('confirm');
    expect(r.calls).toEqual([
      { method: 'post', args: ['/releases/12/validate', undefined, undefined] },
    ]);
  });

  it('distribute is confirm-gated and carries the idempotency option', async () => {
    const blocked = await run(['release', 'distribute', '12'], { answer: '' });
    expect(blocked.code).toBe(1);
    expect(blocked.calls).toHaveLength(0);

    const r = await run(['release', 'distribute', '12', '--yes', '--idempotency-key', 'k-1']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'post',
        args: ['/releases/12/distribute', undefined, { idempotency: true, idempotencyKey: 'k-1' }],
      },
    ]);
  });

  it('takedown is confirm-gated and routes to takedown-all', async () => {
    const blocked = await run(['release', 'takedown', '12'], { answer: 'no thanks' });
    expect(blocked.code).toBe(1);
    expect(blocked.calls).toHaveLength(0);

    const r = await run(['release', 'takedown', '12', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'post', args: ['/releases/12/takedown-all', undefined, undefined] },
    ]);
  });

  it('confirm-review is confirm-gated like the other final actions', async () => {
    const blocked = await run(['release', 'confirm-review', '12'], { answer: '' });
    expect(blocked.code).toBe(1);
    expect(blocked.calls).toHaveLength(0);

    const r = await run(['release', 'confirm-review', '12', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'post', args: ['/releases/12/confirm-review', undefined, undefined] },
    ]);
  });

  it('landing-config reads the smart-link configuration', async () => {
    const r = await run(['release', 'landing-config', '12']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'get', args: ['/releases/12/landing-config', undefined] }]);
  });

  it('short-url posts the release id to the short-url endpoint', async () => {
    const r = await run(['release', 'short-url', '12']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'post', args: ['/releases/short-url', { release_id: 12 }, undefined] },
    ]);
  });
});
