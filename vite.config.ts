import { defineConfig } from 'vite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * vits-web hardcodes two CDNs: cdnjs for onnxruntime's wasm and jsdelivr for
 * the phonemizer. They are module-level constants, so there is nothing to
 * configure at runtime — which is why the old build vendored a patched copy by
 * hand, with a Python script and a lockfile of its own.
 *
 * Same job, done from node_modules: the files come from packages npm has
 * pinned, and the two constants are rewritten to point at our own origin. If
 * the strings ever stop matching, the plugin fails the build rather than
 * quietly letting a CDN back in, and e2e/offline.spec.ts checks the built
 * bundle names no host but Hugging Face.
 */
const ORT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const PHONEMIZE_CDN = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

// GitHub Pages serves project sites from /<repo>/. Set BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    {
      // Everything piper needs, served from where the page is served.
      name: 'mitreden:same-origin-wasm',
      enforce: 'pre' as const,
      transform(code: string, id: string) {
        if (!id.includes('vits-web')) return null;
        if (!code.includes(ORT_CDN) && !code.includes(PHONEMIZE_CDN)) return null;
        return code
          .replaceAll(ORT_CDN, './wasm/')
          .replaceAll(PHONEMIZE_CDN, './wasm/piper_phonemize');
      },
      closeBundle() {
        const out = resolve(__dirname, 'dist', 'wasm');
        mkdirSync(out, { recursive: true });
        // onnxruntime-web does not export its package.json, so these are paths
        // rather than resolutions. Missing means the CDN would be reached at
        // runtime, so it stops the build instead of being skipped.
        const wanted: [string, string][] = [
          ['node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm', 'ort-wasm-simd.wasm'],
          ['node_modules/onnxruntime-web/dist/ort-wasm.wasm', 'ort-wasm.wasm'],
          ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'piper_phonemize.wasm'],
          ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'piper_phonemize.data'],
        ];
        for (const [from, name] of wanted) {
          const source = resolve(__dirname, from);
          if (!existsSync(source)) throw new Error(`Cannot serve ${name} from this origin: ${from} is missing.`);
          copyFileSync(source, resolve(out, name));
        }
      },
    },
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
