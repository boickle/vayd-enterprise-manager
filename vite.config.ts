import path from 'node:path';
import { fileURLToPath } from 'node:url';
// H2: Import from vitest/config so the `test` block is typed.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Config file directory — use as root/envDir so `.env` loads even if the dev server cwd differs. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

/** SPA routes that share a path prefix with public API endpoints (see App.tsx). */
function isPublicSpaDocumentRequest(url: string, acceptHeader: string | undefined): boolean {
  if (!acceptHeader?.includes('text/html')) return false;
  return url.startsWith('/public/room-loader/form');
}

export default defineConfig({
  root: projectRoot,
  envDir: projectRoot,
  plugins: [react()],
  // H2: Component test setup (vitest).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'cypress'],
  },
  server: {
    port: 5173,
    proxy: {
      '/public': {
        target: apiTarget,
        changeOrigin: true,
        bypass(req) {
          const url = req.url ?? '';
          if (isPublicSpaDocumentRequest(url, req.headers.accept)) {
            return '/index.html';
          }
        },
      },
      '/appointments': { target: apiTarget, changeOrigin: true },
      '/auth': { target: apiTarget, changeOrigin: true },
      '/gmail': { target: apiTarget, changeOrigin: true },
    },
  },
});
