import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
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
    },
  },
});
