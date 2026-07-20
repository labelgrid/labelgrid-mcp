import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script, no type declarations.
import { BANNED, scanContent, scanTree } from '../../../../scripts/leak-guard.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Red-flag samples are assembled from fragments at runtime so the literal token
 * never appears in THIS committed file — otherwise the whole-tree scan below
 * would (correctly) flag the test itself.
 */
const j = (...parts: string[]): string => parts.join('');

const SAMPLES: Array<[string, string]> = [
  ['private-key', j('-----BEGIN ', 'PRIVATE KEY-----')],
  ['bearer-token', j('Bearer ', 'aXbYcZ0123456789defghij')],
  ['long-hex-secret', j('deadbeefdeadbeef', 'deadbeefdeadbeef', 'deadbeefdead')],
  ['api-key-literal', j('sk-', 'AbCdEfGhIj0123456789KLM')],
  ['ticket-ref', j('AB', 'C-1234')],
  ['non-production-host', j('some-staging-env', '.labelgrid.com')],
  ['developer-path', j('/Users/', 'devuser', '/project')],
];

describe('leak-guard hygiene-flag detection', () => {
  it('exposes exactly the neutral hygiene matchers', () => {
    const names = new Set(BANNED.map((b: { name: string }) => b.name));
    expect(names).toEqual(
      new Set([
        'private-key',
        'bearer-token',
        'long-hex-secret',
        'api-key-literal',
        'ticket-ref',
        'non-production-host',
        'developer-path',
      ]),
    );
  });

  for (const [label, sample] of SAMPLES) {
    it(`flags a ${label} occurrence`, () => {
      const hits = scanContent(`src/${label}.ts`, `const x = "${sample}";`);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].file).toBe(`src/${label}.ts`);
      expect(hits[0].line).toBe(1);
    });
  }
});

describe('leak-guard allowances', () => {
  it('does not flag safe, legitimate strings', () => {
    const safe = [
      'client.get("/releases")',
      'const url = "https://api.labelgrid.com/api/public";',
      'List the review issues raised against a release.',
      'a short digest like deadbeef is fine',
      'the Authorization header carries a Bearer token',
    ];
    for (const s of safe) {
      expect(scanContent('src/x.ts', s)).toEqual([]);
    }
  });

  it('honours an inline leak-guard-allow pragma on the same line', () => {
    const term = j('AB', 'C-1234');
    const withoutPragma = scanContent('src/x.ts', `const ref = "${term}";`);
    expect(withoutPragma.length).toBeGreaterThan(0);
    const withPragma = scanContent(
      'src/x.ts',
      `const ref = "${term}"; // leak-guard-allow: ${term}`,
    );
    expect(withPragma).toEqual([]);
  });
});

describe('leak-guard whole-tree scan', () => {
  it('passes on the real repository (packages, scripts, docs)', () => {
    const hits = scanTree(REPO_ROOT);
    if (hits.length > 0) {
      // Surface the offending lines to make a failure actionable.
      throw new Error(
        `leak-guard found hygiene red flags:\n${hits
          .map(
            (h: { file: string; line: number; text: string }) =>
              `  ${h.file}:${h.line} "${h.text}"`,
          )
          .join('\n')}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
