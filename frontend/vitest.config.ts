import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@api': path.resolve(__dirname, 'src/api'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['_ARCHIVE/**', 'node_modules/**', 'dist/**'],
    // Raised from vitest's 5s default, deliberately.
    //
    // Several of these render a full React tree in jsdom — `LoginV2`, `Layout`,
    // `useOfflineSync` — and take 3–6s on a loaded machine. Under the default they
    // pass standalone and fail inside `ci:verify`, which runs the frontend suite
    // alongside the backend suite and the guard tests, so the same code fails and
    // passes depending on what else the machine is doing.
    //
    // A timeout that measures load rather than behaviour reports a bug that is not
    // there, and the cost of that is worse than the cost of the extra seconds: it
    // teaches whoever reads the output to re-run before believing it. 20s is still
    // well under the time a genuinely hung test would take to be noticed.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
