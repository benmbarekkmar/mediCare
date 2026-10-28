import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    setupFiles: ['tests/setup/env.ts'],
    // integration specs talk to Fuseki and must not race each other
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60000,
    hookTimeout: 180000,
    reporters: ['default'],
  },
});
