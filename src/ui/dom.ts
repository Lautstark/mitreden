/**
 * The small things every view needs: elements, the status line, the words.
 *
 * The menus that used to sit at the foot of this file are
 * @lautstark/design/menu now - vorlaut carried the same file almost verbatim,
 * and bildhaft the same behaviour in a different shape. They are imported where
 * they are used rather than re-exported from here, so there is one name for the
 * thing and one place it comes from.
 *
 * `el` throws rather than returning null. Every id it is asked for is in
 * index.html, so a miss is a typo or a deleted element, and finding out at the
 * first click is worse than finding out on load.
 */

import { lang, t, type Key, type Vars } from '../i18n/index.ts';
import { announcer, type Announcer } from '@lautstark/design/toast';

/**
 * The one live region, wrapped once.
 *
 * Lazily, because #s is in index.html and this module is imported before the
 * document is necessarily ready to be asked for it - and once, because an
 * announcer holds the pending timer and a second one would not know about the
 * first one's.
 *
 * No `rest`: this line keeps what it last said. bildhaft's empties after 3.2
 * seconds and vorlaut's dims after four, and all three are right about their
 * own page - see the module, which leaves that to the caller on purpose.
 */
let line: Announcer | undefined;
const status = (): Announcer =>
  (line ??= announcer(byId('s'), { busyClass: 'working' }));

/* `byId` was `el` here until 2026-09-02, which is the name bildhaft and
   wochenwerk use for the *opposite* operation — making an element. One word,
   two contradictory meanings, in sibling repositories somebody moves between.
   The implementation is @lautstark/werkzeuge/dom's now and the throw came with
   it: a missing id is a template and a module that have drifted apart, not a
   state sixty call sites should branch on. */
export { byId } from '@lautstark/werkzeuge/dom';
import { byId } from '@lautstark/werkzeuge/dom';

/**
 * What just happened, in words, where a screen reader will read it.
 *
 * It did not, until now. The line carried no role and was toggled with
 * [hidden], so it was out of the accessibility tree at the moment every message
 * arrived and back in it a beat later — which is the one arrangement a live
 * region cannot work under. "42 Sätze hinzugefügt", a saved key and every error
 * this page reports were all silent. Setting the text is the whole of it now;
 * #s is a live region in the markup and stays one.
 *
 * bildhaft had the same bug by another route - it appended the node with the
 * message on it and removed it again - which is why the rule is
 * @lautstark/design/toast's now rather than three separate retellings of it.
 * The module refuses to make a node at all, so there is nothing left here that
 * could put one into the tree at the moment it speaks.
 */
export function say(message: string): void {
  status().say(message);
}

/**
 * The same line, for something that has started rather than finished.
 *
 * The words were already right — "Wird aufgenommen …" — but they arrived in the
 * same grey as "42 hinzugefügt" and then sat there, so the one message that
 * means *wait* looked exactly like the one that means *done*. The class draws a
 * turning ring in front of it, and every ordinary say() takes it away again,
 * which is why the removal is in say() rather than at each callsite: the end of
 * a job is always reported, and forgetting to stop the spinner would leave the
 * page claiming to be busy for the rest of the session.
 */
export const busy = (key: Key, vars?: Vars): void => {
  status().busy(t(key, vars));
};

/** Applies the words to the markup. Redrawing the data is somebody else's job. */
export function applyLang(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]'))
    if (node.dataset.i18n) node.textContent = t(node.dataset.i18n as Key);
  for (const node of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-ph]'))
    if (node.dataset.i18nPh) node.placeholder = t(node.dataset.i18nPh as Key);
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-title]'))
    if (node.dataset.i18nTitle) node.title = t(node.dataset.i18nTitle as Key);
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-aria]'))
    if (node.dataset.i18nAria) node.setAttribute('aria-label', t(node.dataset.i18nAria as Key));
}

// ------------------------------------------------------------------ voices

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
