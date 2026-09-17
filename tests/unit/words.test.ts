/* The words, after the rune moved out to werkzeuge.
 *
 * `ui/words.svelte.ts` is `@lautstark/werkzeuge/reactive-text` since
 * 2026-09-17, and that module ships as **source** behind the `svelte` export
 * condition — `tsc` would publish its `$state(0)` as a call to an undefined
 * identifier, so werkzeuge does not compile it. Something has to, and the
 * something is the `compileModule` transform in `vitest.config.ts`, which only
 * sees what Vite has not handed straight to node. So the first thing this file
 * asserts it asserts by existing: the import at the top either compiled or
 * threw a ReferenceError, and there is no third answer.
 *
 * What is checked past that is the seam, not the lookup — i18n's own tests
 * cover the tables. The seam is that `setLang` moves both halves: the table
 * these lookups delegate to, and the rune behind them. The rune itself is not
 * asserted here — `touched()` is not exported, because both of this product's
 * lookups went into the one `reactiveText` call and nothing here has to make
 * itself a dependency by hand. werkzeuge's own suite holds the rune.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { lang as plainLang, setLang as plainSetLang } from '../../src/i18n/index.ts';
import { lang, setLang, t, tn } from '../../src/ui/words.svelte.ts';

/* `setLang` writes `document.documentElement.lang`, and this suite has no DOM.
   The toolchain's base unstubs globals between tests, so it goes back. */
beforeEach(() => { vi.stubGlobal('document', { documentElement: { lang: '' } }); });

/* The module is shared state, so put the page back in the language the rest of
   the suite expects to find it in. */
afterEach(() => { plainSetLang('de'); });

it('answers in the language the page was set to', () => {
  setLang('en');
  expect(lang()).toBe('en');
  expect(t('source_azure')).toBe('Azure');
  expect(tn('azure_answers', 1)).toBe('1 voice available');
  expect(tn('azure_answers', 3)).toBe('3 voices available');

  setLang('de');
  expect(tn('azure_answers', 3)).toBe('3 Stimmen verfügbar');
});

/* Both halves, because only one of them draws. The non-drawing half of this
   product calls i18n's own `t()` at the moment of a click. */
it('moves i18n\'s own table too, and the element language with it', () => {
  setLang('en');
  expect(plainLang()).toBe('en');
  expect(document.documentElement.lang).toBe('en');
});
