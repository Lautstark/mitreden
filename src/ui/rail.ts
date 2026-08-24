/**
 * The sidebar: which Sammlungen exist, which one you are in, and making one.
 *
 * A Sammlung is a place you work in, not a label a sentence happens to carry.
 * Clicking one opens it; Cmd or Ctrl adds a second, because a sentence can
 * genuinely be in two at once and that has to be reachable.
 */

import { createCollection, deleteCollection as removeCollection, renameCollection } from '../db/repo.ts';
import { lang, t } from '../i18n/index.ts';
import { ALL, DECLARED, OPEN, load, notify } from './state.ts';
import { el, say } from './dom.ts';
import { confirmDialog } from '@lautstark/design/dialog';
import { renameField, type RenameField } from '@lautstark/design/rename';

const counts = (): Map<string, number> => {
  const out = new Map<string, number>();
  for (const item of ALL())
    for (const key of item.collections) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
};

export function drawRail(): void {
  const rows = el('rows');
  rows.innerHTML = '';
  const count = counts();

  for (const collection of DECLARED()) {
    const row = document.createElement('button');
    row.className = `list__item${OPEN.has(collection.key) ? ' on' : ''}`;
    const name = document.createElement('span');
    name.className = 'list__name';
    name.textContent = collection.name;
    const n = document.createElement('span');
    n.className = 'list__count';
    n.textContent = String(count.get(collection.key) ?? 0);
    row.append(name, n);
    row.onclick = (event) => {
      if (event.metaKey || event.ctrlKey) {
        if (OPEN.has(collection.key)) OPEN.delete(collection.key);
        else OPEN.add(collection.key);
      } else {
        OPEN.clear();
        OPEN.add(collection.key);
      }
      closeRail();
      notify();
    };
    rows.appendChild(row);
  }

  // The header names where you are. There is always somewhere to be.
  const here = DECLARED().find((c) => OPEN.has(c.key)) ?? DECLARED()[0];
  // Through refresh() rather than by assigning: it declines while the field is
  // being typed in — the caret jumping mid-word was the reason this guard was
  // written here — and also while a keystroke is still waiting out its
  // debounce, which this copy did not guard and which is the case where the
  // stored name is written back over a half-typed one.
  name?.refresh(here?.name ?? '');
}

/** The bound name field. Module state because drawRail() may only reach the
 *  input through it, and wireRail() is what binds it. */
let name: RenameField | null = null;

export const here = () => DECLARED().find((c) => OPEN.has(c.key)) ?? DECLARED()[0];

function closeRail(): void {
  if (narrow()) {
    el('rail').classList.remove('open');
    el('scrim').hidden = true;
  }
}

/** Below this the rail is a layer over the work, not a column beside it. */
const narrow = (): boolean => matchMedia('(max-width:820px)').matches;

/**
 * Whether the rail is a column of this page at all — bildhaft's, and kept for
 * the same reason: on a laptop the sentences are the work and 268px of
 * Sammlungen is a permanent tax on the width they get. Remembered, because a
 * choice about the shape of the window is not one to make every visit.
 *
 * Only a desktop question. Narrow screens have no rail to collapse; they have
 * one to dismiss, which is what ✕ and the scrim already do.
 */
const RAIL_KEY = 'mitreden.rail';

export function showRail(open: boolean): void {
  document.body.classList.toggle('railed', !open);
  el('reveal').hidden = open;
  localStorage.setItem(RAIL_KEY, open ? 'open' : 'closed');
}

export const restoreRail = (): void =>
  showRail(localStorage.getItem(RAIL_KEY) !== 'closed');

export async function deleteCollection(key: string, name: string, n: number): Promise<void> {
  if (!await confirmDialog({
    title: t('collection_delete'),
    body: t('ask_collection_delete', { name, n }),
    // What happens, which here is the half that is easy to get wrong: the
    // Sammlung goes and the sentences do not.
    confirmLabel: t('collection_delete_do'),
    cancelLabel: t('cancel'),
    closeLabel: t('close'),
    danger: true,
  })) return;
  if (!(await removeCollection(key))) return;
  OPEN.delete(key);
  say(t('done_collection_delete', { name }));
  await load();
}

export function wireRail(): void {
  /* Renaming is typing in the title (§1.6). The debounce, the write on the way
     out and the guard against a repaint typing over you are the package's; what
     is left here is this product's own answer to an empty name, which is to
     refuse it — a Sammlung must always be callable by something in the rail.
     Leaving the field used to re-arm the same 400 ms timer rather than write,
     so a name clicked away from was lost unless nothing navigated in the next
     beat; a blur writes now. */
  name = renameField(el<HTMLInputElement>('colname'), async (typed) => {
    const current = here();
    if (!current || !typed.trim() || typed === current.name) return;
    await renameCollection(current.key, typed);
    await load();
  });

  el('newcol').onclick = async () => {
    const made = await createCollection(null, lang() === 'de');
    OPEN.clear();
    OPEN.add(made.key);
    closeRail();
    say(t('done_collection_new', { name: made.name }));
    await load();
    // Straight into the name, selected: typing replaces the date it was given.
    // Through refresh() like every other assignment — the field is not focused
    // yet, because pressing this button is what took focus off it, so the
    // guard passes and the package's idea of what it last wrote stays true.
    const title = el<HTMLInputElement>('colname');
    name?.refresh(made.name);
    title.focus();
    title.select();
  };

  el('railopen').onclick = () => {
    el('rail').classList.add('open');
    el('scrim').hidden = false;
  };
  el('railclose').onclick = closeRail;
  el('scrim').onclick = closeRail;
  el('railhide').onclick = () => showRail(false);
  el('railshow').onclick = () => showRail(true);
  restoreRail();
}
