import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Tests exercise the sibling workspace package from source, so running
      // the unit suite never depends on a prior `@labelgrid/core` build.
      '@labelgrid/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    passWithNoTests: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
