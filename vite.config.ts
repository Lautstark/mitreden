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
 * either string ever stops matching, the build fails rather than quietly
 * letting a CDN back in, and e2e/offline.spec.ts checks the built bundle names
 * no host it has not been told about.
 *
 * That promise used to be written here and not kept. The guard read
 *
 *     if (!code.includes(ORT_CDN) && !code.includes(PHONEMIZE_CDN)) return null;
 *
 * which bails only when BOTH are absent, and bails by returning rather than by
 * throwing. A version bump inside vits-web moving one of the two would have
 * left that one rewritten, the other pointing at the CDN, and the build green.
 * It could not have been an assertion in transform() either: this plugin sees
 * every module of the package, and most of them contain neither string.
 *
 * So the check is where it can be true - after the whole bundle has been
 * through: each constant has to have been found and rewritten at least once
 * somewhere, whichever file happens to hold it.
 */
const ORT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const PHONEMIZE_CDN = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

/** Which of the two the build actually met and rewrote. See closeBundle. */
const rewritten = new Set<string>();

// GitHub Pages serves project sites from /<repo>/. Set BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    {
      // Everything piper needs, served from where the page is served.
      name: 'mitreden:same-origin-wasm',
      enforce: 'pre' as const,
      // Cleared per build, not per process: `vite build --watch` keeps this
      // module alive across rebuilds, and a set left populated would let the
      // second build inherit the first one's clean bill of health.
      buildStart() {
        rewritten.clear();
      },
      transform(code: string, id: string) {
        if (!id.includes('vits-web')) return null;
        const hasOrt = code.includes(ORT_CDN);
        const hasPhonemize = code.includes(PHONEMIZE_CDN);
        if (!hasOrt && !hasPhonemize) return null;
        if (hasOrt) rewritten.add(ORT_CDN);
        if (hasPhonemize) rewritten.add(PHONEMIZE_CDN);
        return code
          .replaceAll(ORT_CDN, './wasm/')
          .replaceAll(PHONEMIZE_CDN, './wasm/piper_phonemize');
      },
      closeBundle() {
        // Both constants have to have been met. One that was never found is
        // one that moved, and what shipped would reach for it at runtime.
        const missed = [ORT_CDN, PHONEMIZE_CDN].filter((url) => !rewritten.has(url));
        if (missed.length) {
          throw new Error(
            'vits-web no longer contains ' + missed.join(' or ') + '. Nothing was '
            + 'rewritten for it, so the built page would fetch it from that CDN at '
            + 'runtime. Find where the package moved the URL to and update the '
            + 'constant in vite.config.ts.');
        }

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
