/**
 * The small things every view needs: elements, the status line, and menus.
 *
 * `el` throws rather than returning null. Every id it is asked for is in
 * index.html, so a miss is a typo or a deleted element, and finding out at the
 * first click is worse than finding out on load.
 */

import { t, type Key, type Vars } from '../i18n/index.ts';

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`No element with id "${id}" in the page.`);
  return node as T;
}

/** What just happened, in words, where a screen reader will read it. */
export function say(message: string): void {
  const line = el('s');
  line.textContent = message;
  line.hidden = !message;
}

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

// ------------------------------------------------------------------- menus

export type AddItem = (label: string, danger: boolean, run: () => void) => void;

export function closeMenus(): void {
  for (const menu of document.querySelectorAll('.menu')) menu.remove();
  for (const button of document.querySelectorAll('[aria-expanded="true"]'))
    button.setAttribute('aria-expanded', 'false');
}

export function menuOn(button: HTMLElement, build: (add: AddItem) => void): void {
  const open = button.getAttribute('aria-expanded') === 'true';
  closeMenus();
  if (open) return;
  button.setAttribute('aria-expanded', 'true');
  const menu = document.createElement('div');
  menu.className = 'menu';
  build((label, danger, run) => {
    const item = document.createElement('button');
    item.textContent = label;
    if (danger) item.className = 'danger';
    item.onclick = (event) => { event.stopPropagation(); run(); };
    menu.appendChild(item);
  });
  button.parentNode?.appendChild(menu);
}

addEventListener('click', (event) => {
  if (!(event.target as HTMLElement).closest('.menu-anchor')) closeMenus();
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
});

/** Say something that needs a count and a word for it. */
export const busy = (key: Key, vars?: Vars): void => say(t(key, vars));
