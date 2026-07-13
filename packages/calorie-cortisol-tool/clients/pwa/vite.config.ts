import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only Vite config for the demo PWA. Serves the demo app under `app/` on
 * port 5173 and proxies `/api/*` to the API gateway (default localhost:8080),
 * stripping the `/api` prefix so `/api/questionnaire` → gateway `/questionnaire`.
 *
 * This is additive dev tooling; the package's library build (`tsc` over `src/`)
 * is unaffected.
 */
const GATEWAY_URL = process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  // Keep the demo build output separate from the package's tsc library build
  // (`dist/`) so the two never clobber each other.
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      '/api': {
        target: GATEWAY_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
