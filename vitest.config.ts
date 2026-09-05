import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    // Integration tests (Jaeger, conformance) are opt-in: see test/integration.
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
  },
});
