/**
 * The words, in both languages.
 *
 * Imported rather than baked into the page by a build script: the bundler
 * resolves JSON, so `tools/build-site.py` had one job left and no longer has
 * it. Keys are English; a key missing in one language falls back to English
 * and then to the key itself, so a gap is visible instead of blank.
 */

import de from './de.json';
import en from './en.json';

export const STRINGS = { de, en } as const;
export type Lang = keyof typeof STRINGS;

/**
 * The languages this page can be in, in the order they are offered.
 *
 * Codes only. This was a code→name map, and the names in it — „Deutsch",
 * „English" — were what the picker put on its buttons. Those are
 * @lautstark/design/language's `NAMES` now, one copy read by all three
 * products: a language's own name is not a translation, which is the argument
 * that lets a shared package carry it at all. What stays here is the half the
 * package cannot know — which of them this product has words for — and it is
 * read off the tables rather than listed beside them, so a third language is a
 * JSON file and its import and nothing else.
 */
export const LANGS = Object.keys(STRINGS) as readonly Lang[];

/** Every key either language defines, so a lookup is checked rather than hoped. */
export type Key = keyof typeof de | keyof typeof en;

export type Vars = Record<string, string | number>;

let current: Lang = 'de';

export const lang = (): Lang => current;
export const setLang = (value: Lang): void => { current = value; };

export function t(key: Key, vars?: Vars): string {
  const table = STRINGS[current] as Record<string, string>;
  const fallback = STRINGS.en as Record<string, string>;
  let text = table[key] ?? fallback[key] ?? String(key);
  if (vars) for (const [name, value] of Object.entries(vars))
    text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

/**
 * Singular and plural are separate keys — languages disagree about where the
 * line falls, and "1 Sätze" is the kind of thing you stop seeing yourself.
 */
export const tn = (key: string, n: number, vars?: Vars): string =>
  t(`${key}_${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars });
