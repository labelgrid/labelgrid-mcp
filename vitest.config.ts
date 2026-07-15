import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
