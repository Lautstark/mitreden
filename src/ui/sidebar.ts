/**
 * The breakpoint, read once and from the package.
 *
 * 820px is conventions.md §3.1's number and it is written down three times in
 * this product: here, in `src/styles/app.css`, and inside
 * `@lautstark/design/svelte/Sidebar`, which subscribes to it live. The string
 * comes from `@lautstark/design/svelte/sidebar` so that this page and that
 * component are written against the same string rather than the same memory of
 * it — a CSS file cannot read a JavaScript constant, which is exactly why the
 * constant is exported for the stylesheet to be written against.
 *
 * ## Why this is a module and not four lines of App.svelte
 *
 * It was four lines of App.svelte, and `svelte-check` cannot have it there.
 * The package's exports map carries `./svelte/Sidebar` (the component) and
 * `./svelte/sidebar` (this constant) as two entries differing only in case, and
 * `tsc` resolves each correctly — `--traceResolution` shows the lowercase
 * specifier landing on `svelte/sidebar.d.ts`. `svelte-check` on a
 * case-insensitive filesystem does not: asked for both from inside one
 * `.svelte` file it hands back the component for both, and the error it reports
 * is that the *component* has no exported member `NARROW`, which names neither
 * the file nor the cause. Measured on 2026-09-17: the same import from a
 * `.svelte` file that does not also import `Sidebar` typechecks, and so does
 * this file.
 *
 * Writing '(max-width: 820px)' out in App.svelte instead would have been the
 * obvious way round it and is the one thing worth not doing — the constant
 * exists so the number is in one place, and a copy of it made to get past a
 * tool is a copy nobody will remember is a copy.
 */
import { NARROW } from '@lautstark/design/svelte/sidebar';

export { NARROW };

/** Below this the sidebar is a layer over the work, not a column beside it.
 *  Asked at the moment of a press, which is all this page needs: the answer
 *  that has to stay *current* is `Sidebar`'s, and it subscribes. */
export const narrow = (): boolean => matchMedia(NARROW).matches;
