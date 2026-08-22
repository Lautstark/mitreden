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
export const LANGUAGES: Record<Lang, string> = { de: 'Deutsch', en: 'English' };

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
