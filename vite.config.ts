import { defineConfig } from 'vite';
import { piperVendor } from '@lautstark/stimmquelle/vite';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

// GitHub Pages serves project sites from /<repo>/. Set BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    /**
     * Everything piper runs on, served from where the page is served.
     *
     * `usePiperRuntime()` in src/core/audio.ts names one directory and
     * stimmquelle asks it for all four files: the phonemizer's wasm and its
     * espeak data, and onnxruntime's binaries. One base for both sets is the
     * package's contract, the two sets live in two npm packages, and no CDN
     * serves them from one place, so something has to put them side by side
     * under this origin. In a build that is a copy into dist/wasm/; in dev it
     * is middleware answering out of node_modules, which is the one place the
     * first recording would otherwise fail — and the place somebody would go
     * to check that it does not.
     *
     * `wasm` rather than the package's default `vendor`, because that is where
     * this page has served them from since before there was a package to ask,
     * and moving it would move a URL for no reason. The same string is passed
     * to `piperRuntime()` in audio.ts; they are two ends of one URL.
     *
     * This was mitreden's own plugin until stimmquelle v2.3.0. Two products
     * had written it independently and arrived at the same four files, the
     * same directory and the same failure modes — including the check that a
     * copy arrived whole, which is here because a truncated espeak archive
     * keeps the right name and the right leading bytes and fails much later,
     * as a broken voice rather than a broken build.
     *
     * It also had a second half once. vits-web hardcoded two CDNs — cdnjs for
     * onnxruntime's wasm and jsdelivr for the phonemizer — as module-level
     * constants with nothing to configure, so a transform rewrote both to
     * point here. Driving piper ourselves removed vits-web and with it the
     * strings: there is nothing left to rewrite. What that guard protected is
     * protected one layer further out, by e2e/offline.spec.ts reading the
     * built bundle for hosts it has not been told about.
     *
     * Only two of onnxruntime's several binaries, which is the package's
     * default: the threaded pair is asked for only on a cross-origin-isolated
     * page, and GitHub Pages sends none of the headers that make one.
     */
    piperVendor({ dir: 'wasm' }),
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
