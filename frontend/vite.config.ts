// ENTERPRISE FIX: Phase 1 - Dual Mode Implementation - 2026-03-02
// Vite config with explicit plugin path workaround (PWA Support via public/sw.js)
import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to dynamically import the plugin
let reactPlugin = null;
try {
  const plugin = await import('@vitejs/plugin-react');
  reactPlugin = plugin.default;
} catch (e) {
  console.error('Failed to load @vitejs/plugin-react:', e.message);
  // Fallback - use basic config without react plugin
  reactPlugin = () => ({ name: 'noop' });
}

export default defineConfig(({ mode }) => ({
  plugins: [reactPlugin()],

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

  server: {
    port: 5173,
    open: mode !== 'production',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },

  build: {
    target: 'es2020',
    sourcemap: true,
  },
}));
