import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

// GitHub Pages serves project sites from /<repo>/. Set BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      // GitHub Pages has no rewrite rules. Serving the SPA shell as 404.html
      // makes deep links resolve to the app instead of a Pages error page.
      name: 'mitreden:spa-404',
      closeBundle() {
        const out = resolve(__dirname, 'dist');
        copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
      },
    },
  ],
  build: {
    target: 'es2022',
    // The piper model and the wasm it runs on are fetched, never inlined.
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
});
