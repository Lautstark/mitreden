/**
 * The sidebar: which Sammlungen exist, which one you are in, and making one.
 *
 * A Sammlung is a place you work in, not a label a sentence happens to carry.
 * Clicking one opens it; Cmd or Ctrl adds a second, because working across two
 * of them at once is a real thing to be doing, and that has to be reachable.
 * §4.2, which is about the open set and not about how many Sammlungen a
 * sentence is in.
 */

import {
  createCollection, deleteCollection as removeCollection, renameCollection,
  saveRailOpen, settings,
} from '../db/repo.ts';
import { lang, t } from '../i18n/index.ts';
import { ALL, DECLARED, OPEN, load, notify } from './state.ts';
import { el, say } from './dom.ts';
import { confirmDialog } from './dialog.ts';
import { renameField, type RenameField } from '@lautstark/design/rename';
import { drawCollections } from '@lautstark/design/collections';

const counts = (): Map<string, number> => {
  const out = new Map<string, number>();
  for (const item of ALL())
    if (item.collection) out.set(item.collection, (out.get(item.collection) ?? 0) + 1);
  return out;
};

export function drawRail(): void {
  const rows = el('rows');
  const count = counts();

  /* The rows are @lautstark/design/collections'. What is left here is what a
     row means in this program: a Sammlung's count is how many sentences are in
     it, and a press either opens it alone or adds it to what is open. Which
     key that flag stands for is
     the package's, so it cannot become Shift here and Cmd elsewhere. mitreden
     is still the one product that uses the additive flag — §4.2 — and that did
     not change when arity did. */
  drawCollections(rows, {
    rows: DECLARED().map((collection) => ({
      id: collection.id,
      name: collection.name,
      count: count.get(collection.id) ?? 0,
    })),
    open: OPEN,
    onPick: (key, additive) => {
      if (additive) {
        if (OPEN.has(key)) OPEN.delete(key);
        else OPEN.add(key);
      } else {
        OPEN.clear();
        OPEN.add(key);
      }
      closeRail();
      notify();
    },
  });

  // The header names where you are. There is always somewhere to be.
  const here = DECLARED().find((c) => OPEN.has(c.id)) ?? DECLARED()[0];
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

export const here = () => DECLARED().find((c) => OPEN.has(c.id)) ?? DECLARED()[0];

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
 *
 * Kept in the settings record with every other preference, not in localStorage
 * — conventions.md §1.3. The scheme and the language are still in localStorage
 * and that is not an inconsistency: both have to be readable before the first
 * paint or the page flashes and corrects itself. This one is allowed to arrive
 * a frame late, which is the whole of the difference.
 */
export function showRail(open: boolean, remember = true): void {
  document.body.classList.toggle('railed', !open);
  el('reveal').hidden = open;
  if (remember) void saveRailOpen(open);
}

/** What it was set to last time. Absent means open: a rail nobody has put away
 *  is there, and a first visit should not have to say so. */
export const restoreRail = async (): Promise<void> =>
  showRail((await settings()).railOpen !== false, false);

export async function deleteCollection(key: string, name: string, n: number): Promise<void> {
  if (!await confirmDialog({
    title: t('collection_delete'),
    body: t('ask_collection_delete', { name, n }),
    // What happens, which here is the half that is easy to get wrong: the
    // Sammlung goes and the sentences do not.
    confirmLabel: t('collection_delete_do'),
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
  const title = el<HTMLInputElement>('colname');
  /* Which Sammlung a pending rename is for, taken on the keystroke rather than
     read when the write runs. Pressing a rail row moves focus off the field
     first, so the blur writes before the switch and the two are the same in
     practice — but that is an ordering, not a guarantee, and this file had the
     capture before the package arrived. The package owns the timing and not
     what is being renamed, which is why it binds with addEventListener and
     leaves room for this listener beside its own. */
  let renaming: { id: string; name: string } | null = null;
  title.addEventListener('input', () => { renaming = here() ?? null; });

  name = renameField(title, async (typed) => {
    if (!renaming || !typed.trim() || typed === renaming.name) return;
    await renameCollection(renaming.id, typed);
    await load();
  });

  el('newcol').onclick = async () => {
    const made = await createCollection(null, lang() === 'de');
    OPEN.clear();
    OPEN.add(made.id);
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
  void restoreRail();
}
