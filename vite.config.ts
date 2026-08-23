import { defineConfig } from 'vite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Everything piper runs on, served from where the page is served.
 *
 * `usePiperRuntime()` in src/core/audio.ts names one directory — `wasm/` — and
 * stimmquelle asks it for all four files: the phonemizer's wasm and its espeak
 * data, and onnxruntime's binaries. One base for both sets is the package's
 * contract, the two sets live in two npm packages, and no CDN serves them from
 * one place, so this copy is what makes that directory exist.
 *
 * This used to have a second half. vits-web hardcoded two CDNs — cdnjs for
 * onnxruntime's wasm and jsdelivr for the phonemizer — as module-level
 * constants with nothing to configure, so a transform rewrote both to point
 * here. Driving piper ourselves means nothing hardcodes a CDN any more: the
 * base is a value we pass in, so there is no string left to rewrite and no
 * guard needed against the package moving one. What the guard was protecting
 * is still protected, one layer further out, by e2e/offline.spec.ts reading
 * the built bundle for hosts it has not been told about.
 *
 * Two of onnxruntime's several binaries, not all: the threaded pair is only
 * ever asked for on a cross-origin-isolated page, and GitHub Pages sends none
 * of the headers that make one.
 *
 * onnxruntime-web does not export its package.json, so these are paths rather
 * than resolutions — and onnxruntime-web is pinned exactly in package.json for
 * that reason, because the binaries beside the page have to be the ones the
 * module bundled from the same version expects.
 */
const VENDORED: [string, string][] = [
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'piper_phonemize.wasm'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'piper_phonemize.data'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm', 'ort-wasm-simd.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm.wasm', 'ort-wasm.wasm'],
];

/* `.wasm` has to be application/wasm or instantiateStreaming refuses it; the
 * espeak archive is bytes with no better name. */
const typeOf = (name: string): string =>
  name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';

// GitHub Pages serves project sites from /<repo>/. Set BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    {
      name: 'mitreden:same-origin-wasm',
      /**
       * The dev server has no dist/ to have copied into, so the same four
       * files are answered straight out of node_modules under the same names.
       * Without this, `npm run dev` is the one place the first recording fails
       * — and it is the place somebody would go to check that it does not.
       */
      configureServer(server) {
        server.middlewares.use(`${base}wasm`, (request, response, next) => {
          const wanted = VENDORED.find(([, name]) => request.url === `/${name}`);
          if (!wanted) return next();
          response.setHeader('Content-Type', typeOf(wanted[1]));
          response.end(readFileSync(resolve(__dirname, wanted[0])));
        });
      },
      closeBundle() {
        const out = resolve(__dirname, 'dist', 'wasm');
        mkdirSync(out, { recursive: true });
        for (const [from, name] of VENDORED) {
          const source = resolve(__dirname, from);
          // A file that is not there means the first recording would fail with
          // a fetch error nobody connects to a build. Stop the build instead.
          if (!existsSync(source)) throw new Error(`Cannot serve ${name} from this origin: ${from} is missing.`);
          const target = resolve(out, name);
          copyFileSync(source, target);
          // And check what arrived, not only what was read from: a truncated
          // copy keeps the right name and the right leading bytes, the wasm
          // still instantiates on a short .data, and the phonemizer fails
          // later on whichever language was in the part that never came —
          // which reads as a broken voice rather than as a broken build.
          const [read, written] = [statSync(source).size, statSync(target).size];
          if (read !== written) {
            throw new Error(
              `${name} arrived short: ${written} of ${read} bytes. Delete dist/wasm/${name} `
              + 'and build again; if it recurs, the disk or node_modules is at fault.');
          }
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
