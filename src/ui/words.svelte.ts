/**
 * The words, reactive.
 *
 * `src/i18n/index.ts` holds the tables and the lookup and is deliberately left
 * as it was: it is imported by three unit tests and by the modules that answer
 * a click rather than draw, and none of those wants a rune in it.
 *
 * What is here is the half a component needs. This page changes language
 * without reloading — the row that does it is a panel in its own settings sheet
 * — and until now that was `applyLang()` walking every `[data-i18n]` in the
 * document and writing over it, plus five hand-written redraws for the words
 * that were never in the markup to begin with. A component reads `t()` while it
 * draws, so the only thing missing was for `t()` to *be* a dependency.
 *
 * `void current` is the whole mechanism: reading the rune inside the lookup
 * signs every template that calls it up for the next change. Nothing has to
 * remember to repaint, and there is no list of things that were forgotten —
 * which is what `chooseLang()` was, and what it got wrong twice (the backup
 * panel, then the three scheme labels).
 */

import {
  lang as read, setLang as write, t as look, tn as lookMany,
  type Key, type Lang, type Vars,
} from '../i18n/index.ts';

let current = $state<Lang>(read());

/** Which language the page is in. Read this in a component, not i18n's. */
export const lang = (): Lang => current;

/**
 * The page's language, changed in both places at once.
 *
 * Both, because the tables are not reactive and must not become so: the
 * non-drawing half of this product — the file importer, the printed sheet
 * notes, the sentence a status line is handed — calls i18n's own `t()` at the
 * moment of a click, and would answer in the previous language if only the
 * rune moved.
 */
export function setLang(code: Lang): void {
  write(code);
  current = code;
  document.documentElement.lang = code;
}

export function t(key: Key, vars?: Vars): string {
  void current;
  return look(key, vars);
}

export function tn(key: string, n: number, vars?: Vars): string {
  void current;
  return lookMany(key, n, vars);
}

/**
 * Where a voice comes from. stimmquelle's word for it is the backend, which is
 * the wrong half of the answer to give somebody choosing one: what they are
 * deciding is whether it is already here or has to be fetched from a company.
 */
export const sourceOf = (source: string): string =>
  t(source === 'azure' ? 'source_azure' : source === 'system' ? 'source_system' : 'source_piper');

/**
 * What a voice speaks, named in the language of whoever is reading. `de_DE` is
 * piper's spelling and `de-DE` is Azure's; only the second is a language tag,
 * so the first is made into one rather than shown raw.
 */
export function speaks(locale: string): string {
  const tag = locale.replaceAll('_', '-');
  try {
    return new Intl.DisplayNames([lang()], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export type { Key, Lang, Vars };
