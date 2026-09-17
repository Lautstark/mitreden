import { vitestConfig } from '@lautstark/toolchain/vitest';
import { compileModule } from 'svelte/compiler';

/*
 * The checks that need no browser.
 *
 * mitreden's suite has been Playwright-only, which suited a page whose whole
 * behaviour is in the DOM. The standing backup brought a different kind of
 * question: what may be written into a folder that a sync client will carry
 * off the machine, and whether a library still survives the round trip out and
 * back. Neither is visible from the outside — an e2e can watch a file appear
 * but cannot assert what must never be inside it.
 *
 * The node environment, the mock restoring and the stubbed globals are
 * @lautstark/toolchain's base; what is passed is what is this product's: where
 * the files are, and the twelve lines below.
 */

/**
 * Runes, for the one suite whose imports reach the page's layer.
 *
 * Nothing here renders. tests/unit/shelf.test.ts asks what mitreden does with a
 * `?sammlung=` link and mocks away everything that draws — but the module it
 * imports for real opens a Sammlung through `ui/store.svelte.ts`, and `$state`
 * in a `.svelte.ts` is a compiler form rather than a function anybody can call.
 * Without this the import throws a ReferenceError out of a file the test is not
 * about.
 *
 * Twelve lines rather than `@sveltejs/vite-plugin-svelte`, which is what this
 * was first and what does not work here: the plugin declares an `optimizeDeps`
 * set, which turns vitest's dependency optimizer on, and the optimizer fails on
 * its own runtime's `node:module` import before a single test is collected. It
 * is also more than is wanted — the plugin exists to compile components, and
 * there is not a component in this directory.
 *
 * `post`, so that Vite has already taken the TypeScript out: `compileModule`
 * reads JavaScript, and these files are `.svelte.ts`.
 */
const runes = {
  name: 'mitreden:runes',
  enforce: 'post' as const,
  transform(code: string, id: string) {
    if (!/\.svelte\.[jt]s($|\?)/.test(id)) return null;
    const made = compileModule(code, { filename: id, dev: false });
    return { code: made.js.code, map: made.js.map };
  },
};

export default vitestConfig({
  include: ['tests/unit/**/*.test.ts'],
  setupFiles: ['./tests/unit/setup.ts'],
  /*
   * And the transform above only sees what Vite is processing.
   *
   * `@lautstark/werkzeuge/reactive-text` — which `ui/words.svelte.ts` is built
   * on since 2026-09-17 — ships as **source** behind the `svelte` export
   * condition, because `tsc` would emit its `$state(0)` as a call to an
   * undefined identifier and publish that. A dependency handed to node reaches
   * no transform at all, `post` or otherwise, and the import then throws the
   * same ReferenceError the twelve lines above exist to prevent, out of a
   * package this suite has no opinion about. conventions.md §6.0 asks every
   * consumer of a shared rune module for this line, and werkzeuge's own header
   * names this repository as the case.
   *
   * Two things measured here on 2026-09-17 and worth writing down. Vite does
   * not externalise a dependency whose entry is a `.ts` file, so today the
   * module is inlined and compiled with the line absent — which is exactly why
   * it is written down rather than left to hold by accident: nothing would go
   * red the day that stopped being true. And the regex is narrowed to `src/`
   * on purpose. Inlining the whole package drags werkzeuge's compiled `dist/`
   * through Vite as well, and that turned a one-second suite into
   * twenty-five; `src/` is where the rune is and the only thing here that
   * cannot be externalised.
   */
  server: { deps: { inline: [/@lautstark\/werkzeuge\/src\//] } },
}, {
  plugins: [runes],
});
