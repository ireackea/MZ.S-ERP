// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendOrigin = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:3000';

const allowedDevHosts = ['localhost', '127.0.0.1', '.app.github.dev', '.preview.github.dev'];

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

  esbuild: {
    charset: 'utf8',
  },

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
    host: '0.0.0.0',
    port: 5173,
    open: mode !== 'production',
    allowedHosts: allowedDevHosts,
    proxy: {
      '/api': {
        target: backendOrigin,
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: backendOrigin,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },

  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'export-xlsx': ['xlsx'],
          'export-exceljs': ['exceljs'],
          'export-html2pdf': ['html2pdf.js'],
        },
      },
    },
  },

  optimizeDeps: {
    exclude: ['xlsx', 'exceljs', 'html2pdf.js'],
  },
}));
