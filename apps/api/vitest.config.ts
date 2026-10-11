import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      // `json-summary` writes coverage/coverage-summary.json, which
      // `.github/scripts/coverage-gate.mjs` reads to enforce the floor.
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.d.ts'],
      // Write the report even when a test fails, so the floor step reports the
      // coverage number rather than "summary not found".
      reportOnFailure: true,
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cipansor/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
