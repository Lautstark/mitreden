import { vitestConfig } from '@lautstark/toolchain/vitest';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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
 * @lautstark/toolchain's base now; what is passed is what is this product's:
 * where the files are, and the compiler.
 *
 * The compiler, because one of these suites reaches the page's layer. None of
 * them renders anything — tests/unit/shelf.test.ts asks what mitreden does with
 * a `?sammlung=` link, and mocks away everything that draws — but the module it
 * imports for real now opens a Sammlung through ui/store.svelte.ts, and a
 * `.svelte.ts` module is runes: `$state` is a compiler form, not a function
 * anybody can call. Without the plugin the import throws a ReferenceError from
 * a file the test is not about.
 */
export default vitestConfig({
  include: ['tests/unit/**/*.test.ts'],
  setupFiles: ['./tests/unit/setup.ts'],
}, {
  plugins: [svelte()],
});
