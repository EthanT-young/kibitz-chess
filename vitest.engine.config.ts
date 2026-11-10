import { defineConfig } from 'vitest/config';

// Slow tests that run the real Stockfish WASM engine inside Node.
export default defineConfig({
  test: {
    include: ['tests/engine/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
