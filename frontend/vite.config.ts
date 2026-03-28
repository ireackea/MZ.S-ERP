// ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendOrigin = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:3001';
const monitoringProvider = (process.env.VITE_MONITORING_PROVIDER || 'sentry').trim().toLowerCase();
const monitoringEnabled = Boolean(process.env.VITE_SENTRY_DSN || process.env.VITE_LOGROCKET_APP_ID);
const monitoringConfig = {
  enabled: monitoringEnabled,
  provider: monitoringEnabled ? monitoringProvider : 'disabled',
  sentryDsn: process.env.VITE_SENTRY_DSN || '',
  logRocketAppId: process.env.VITE_LOGROCKET_APP_ID || '',
  environment: process.env.VITE_MONITORING_ENV || process.env.NODE_ENV || 'production',
  release: process.env.VITE_RELEASE || process.env.npm_package_version || '0.0.0',
};

const allowedDevHosts = ['localhost', '127.0.0.1', '.app.github.dev', '.preview.github.dev'];
const heavyLazyLibraries = ['xlsx', 'exceljs', 'html2pdf.js'] as const;

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

  define: {
    __APP_MONITORING__: JSON.stringify(monitoringConfig),
    __APP_BUILD_INFO__: JSON.stringify({
      mode,
      release: monitoringConfig.release,
      backendOrigin,
    }),
  },

  esbuild: {
    charset: 'utf8',
    legalComments: 'none',
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
    sourcemap: false,
    minify: 'esbuild',
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 4096,
    rollupOptions: {
      onwarn(warning, warn) {
        const message = String(warning.message || '');
        if (message.includes('frontend/src/api/client.ts is dynamically imported')) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          'export-xlsx': [heavyLazyLibraries[0]],
          'export-exceljs': [heavyLazyLibraries[1]],
          'export-html2pdf': [heavyLazyLibraries[2]],
          'vendor-recharts': ['recharts'],
          'vendor-datepicker': ['react-datepicker'],
          'vendor-fuse': ['fuse.js'],
        },
      },
    },
  },

  optimizeDeps: {
    exclude: [...heavyLazyLibraries, 'recharts', 'react-datepicker', 'fuse.js'],
  },
}));
