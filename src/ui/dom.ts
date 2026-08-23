/**
 * The small things every view needs: elements, the status line, and menus.
 *
 * `el` throws rather than returning null. Every id it is asked for is in
 * index.html, so a miss is a typo or a deleted element, and finding out at the
 * first click is worse than finding out on load.
 */

import { lang, t, type Key, type Vars } from '../i18n/index.ts';

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`No element with id "${id}" in the page.`);
  return node as T;
}

/**
 * What just happened, in words, where a screen reader will read it.
 *
 * It did not, until now. The line carried no role and was toggled with
 * [hidden], so it was out of the accessibility tree at the moment every message
 * arrived and back in it a beat later — which is the one arrangement a live
 * region cannot work under. "42 Sätze hinzugefügt", a saved key and every error
 * this page reports were all silent. Setting the text is the whole of it now;
 * #s is a live region in the markup and stays one.
 */
export function say(message: string): void {
  const line = el('s');
  line.textContent = message;
  line.classList.remove('working');
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
  const line = el('s');
  line.textContent = t(key, vars);
  line.classList.add('working');
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

/** What this voice costs to have before it will speak. */
export const weighs = (bytes: number): string =>
  `${Math.round(bytes / 1e6)} MB`;

// ------------------------------------------------------------------- menus

/**
 * What an item is besides its label. All three optional, because the common
 * item is a plain command and should read as one at the callsite.
 *
 * `checked` is deliberately a tri-state: left off, the item is a command and
 * gets role="menuitem"; set either way, the menu is a set of alternatives and
 * the item gets role="menuitemradio". That distinction used to be carried by a
 * positional boolean, and it drifted — the same third argument meant "this is
 * destructive" here and "this one is in force" in vorlaut, which is how two
 * copies of one function ended up announcing opposite things. Naming the field
 * is what stops that recurring.
 */
export type ItemOpts = { danger?: boolean; checked?: boolean; disabled?: boolean };

export type AddItem = (label: string, run: () => void, opts?: ItemOpts) => void;

/** The trigger the open menu belongs to, so focus has somewhere to go back to. */
let opener: HTMLElement | null = null;

/** The items worth landing on. A disabled one is skipped, not stepped through. */
const rows = (menu: Element): HTMLElement[] =>
  [...menu.querySelectorAll<HTMLElement>('button:not(:disabled)')];

export function closeMenus(): void {
  for (const menu of document.querySelectorAll('.menu')) {
    // Focus returns to the trigger only when it was inside the menu to begin
    // with. Escape and an activated item both arrive here with focus in the
    // list, and both want it back on the button that opened it; a click
    // somewhere else on the page arrives here too, and pulling focus back
    // would yank it out of whatever that click just gave it to.
    if (menu.contains(document.activeElement)) opener?.focus();
    menu.remove();
  }
  opener = null;
  for (const button of document.querySelectorAll('[aria-expanded="true"]'))
    button.setAttribute('aria-expanded', 'false');
}

/** Home/End and the arrows, the shape stepVoices() uses on the voice list. */
function stepMenu(event: KeyboardEvent): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const menu = event.currentTarget as HTMLElement;
  const list = rows(menu);
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || !list.length) return;
  event.preventDefault();
  const to = event.key === 'Home' ? 0
    : event.key === 'End' ? list.length - 1
      : event.key === 'ArrowDown'
        ? (at + 1) % list.length
        : (at - 1 + list.length) % list.length;
  list[to]!.focus();
}

export function menuOn(button: HTMLElement, build: (add: AddItem) => void): void {
  const open = button.getAttribute('aria-expanded') === 'true';
  closeMenus();
  if (open) return;                       // a second press is a dismissal
  button.setAttribute('aria-expanded', 'true');
  // "menu" rather than "true": both open a menu as far as the ARIA spec goes,
  // but the first says which kind, and the markup that spells it out is in
  // index.html on some of these triggers and not others.
  button.setAttribute('aria-haspopup', 'menu');
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  build((label, run, opts = {}) => {
    const item = document.createElement('button');
    // Explicit, because a <button> inside a <form> submits it by default and
    // these are drawn into whatever the page happens to be.
    item.type = 'button';
    item.textContent = label;
    item.setAttribute('role', opts.checked === undefined ? 'menuitem' : 'menuitemradio');
    if (opts.checked !== undefined) item.setAttribute('aria-checked', String(opts.checked));
    if (opts.danger) item.className = 'danger';
    if (opts.disabled) item.disabled = true;
    item.onclick = (event) => { event.stopPropagation(); run(); };
    menu.appendChild(item);
  });
  menu.addEventListener('keydown', stepMenu);
  button.parentNode?.appendChild(menu);
  opener = button;
  // Focus goes in, or the menu is only open in the drawing: a reader left on
  // the trigger is told the list expanded and then has nothing to read, and a
  // keyboard has no way into it at all. This was the whole of the defect.
  rows(menu)[0]?.focus();
}

addEventListener('click', (event) => {
  if (!(event.target as HTMLElement).closest('.menu-anchor')) closeMenus();
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
});
