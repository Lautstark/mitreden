/**
 * What the page is currently showing.
 *
 * The subscriber list is gone. It was three watcher arrays — `subscribe`,
 * `onWork`, `onLanded` — and the whole coupling between the sidebar, the list and
 * the composer, and every one of them existed to answer the same question:
 * *who has to be told*. Nobody has to be told. Whatever reads `shown()` while
 * it draws is drawn again when the sentences move, and that is the entire
 * arrangement.
 *
 * `$state.raw` for the two loaded lists. They are replaced whole and never
 * edited in place, and a deep proxy over them would be paid for on every row;
 * more to the point, a record read out of a proxy cannot go back into
 * IndexedDB, and `db/` is handed records from here. Whatever leaves a component
 * for a store goes through `$state.snapshot()`.
 */

import { collections as loadCollections, phrases, saveOpen, settings } from '../db/repo.ts';
import type { CollectionWithCount, PhraseWithState } from '../core/types.ts';

/**
 * Rendering thousands of rows makes the page crawl and nobody reads that far.
 * Counts and downloads always cover everything that matches, not just what is
 * drawn.
 */
export const CAP = 200;

let all = $state.raw<readonly PhraseWithState[]>([]);
let declared = $state.raw<readonly CollectionWithCount[]>([]);

export const ALL = (): readonly PhraseWithState[] => all;
export const DECLARED = (): readonly CollectionWithCount[] => declared;

/**
 * Which Sammlungen are open.
 *
 * A `Set` that is replaced rather than edited, which is what makes it a
 * `$state.raw`: the places that change it each hand back a new one, so there is
 * no membership change a reader can miss. It was a mutable module `Set` beside
 * a `notify()` that every caller had to remember to call.
 */
let open = $state.raw<ReadonlySet<string>>(new Set());

export const OPEN = (): ReadonlySet<string> => open;

/** The one place the set is replaced, so the write below cannot be skipped by a
 *  fifth caller who has never heard of it. Same shape as db.ts's touched(). */
function setOpen(next: ReadonlySet<string>): void {
  open = next;
  remember();
}

export function openOnly(id: string): void {
  setOpen(new Set([id]));
}

export function openAlso(id: string): void {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setOpen(next);
}

export function closeCollection(id: string): void {
  if (!open.has(id)) return;
  const next = new Set(open);
  next.delete(id);
  setOpen(next);
}

/**
 * The last set written, so that a repaint does not rewrite it.
 *
 * Most of what moves on this page has nothing to do with which Sammlung is
 * open. Writing the settings record each time would be harmless in the store
 * and loud everywhere else: every writer of it announces a change through
 * db.ts's notifier, so the standing backup would reschedule itself on every
 * keystroke that redraws a row.
 */
let remembered: string | null = null;

/**
 * Whatever is open, kept in the settings record — conventions.md §1.2, and the
 * whole set rather than one of them, because several can be open at once (§4.2)
 * and "where I was" is all of the places I was.
 */
function remember(): void {
  const now = [...open].join('\u0000');
  if (now === remembered) return;
  remembered = now;
  void saveOpen([...open]);
}

/**
 * What was open last time, before anything is drawn.
 *
 * Ids that no longer name a Sammlung are dropped in `load()` rather than
 * trusted here: the record is written by a page that had them and read by one
 * that may not — a restore, a wipe, or a Sammlung deleted in another tab.
 */
export async function restoreOpen(): Promise<void> {
  const held = (await settings()).open ?? [];
  open = new Set(held);
  // Not a write: this is what was read, so remembering it stops load() writing
  // the same set straight back.
  remembered = [...open].join('\u0000');
}

/** What is typed in the sidebar's search field. It was read off the input by id on
 *  every draw; it is the value the field is bound to now. */
let query = $state('');

export const asked = (): string => query;
export const ask = (text: string): void => { query = text; };
export const searching = (): boolean => query.trim().length > 0;

/**
 * Searching German without a German keyboard: "hor auf", "hoer auf" and
 * "Hör auf" all have to find the same sentence, so every one is indexed in
 * both spellings and the query is tried in both too.
 */
const bare = (s: string): string =>
  s.toLowerCase().replaceAll('ß', 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
const umlaut = (s: string): string =>
  s.toLowerCase().replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss');
const haystack = (item: PhraseWithState): string =>
  `${bare(item.text)} | ${umlaut(item.text)} | ${item.collection ?? ''}`;

export function found(): readonly PhraseWithState[] {
  const wanted = query.trim();
  if (!wanted) return all;
  const a = bare(wanted);
  const b = umlaut(wanted);
  return all.filter((item) => {
    const hay = haystack(item);
    return hay.includes(a) || hay.includes(b);
  });
}

/**
 * Search first, then the Sammlung — the union of whatever is open. There was a
 * third axis, a row of pills narrowing to one voice, and it was answering a
 * question nobody had: every row already names its own voice, and a Sammlung is
 * small enough to read.
 *
 * The multi-select survives arity changing (§4.2, which reads as though it
 * followed from §4.1 and does not): how many Sammlungen may be open at once and
 * how many a sentence may be in are separate questions.
 */
export function shown(): readonly PhraseWithState[] {
  const list = found();
  return open.size
    ? list.filter((item) => item.collection !== undefined && open.has(item.collection))
    : list;
}

/** The Sammlung the page is in. There is always somewhere to be. */
export const here = (): CollectionWithCount | undefined =>
  declared.find((one) => open.has(one.id)) ?? declared[0];

/** Whether the list has been asked to show everything past the cap. */
let past = $state(false);
export const showingAll = (): boolean => past;
export const showAll = (): void => { past = true; };

/**
 * What is being recorded at this moment, and what is behind it in the queue.
 *
 * A sentence's State is derived from whether its audio exists, so it has no
 * word for this: from the moment the sentence is saved until the recording
 * lands, "noch nicht aufgenommen" is the true answer and it reads as nothing
 * happening — at the one point where something is, and where it can take a
 * minute because the voice is still being fetched. This is that missing word.
 *
 * It lives here rather than in the row because a recording is started from
 * three places — typing, the ⋯ menu, editing a sentence — and all three draw
 * the same rows.
 */
let queue = $state.raw<ReadonlySet<string>>(new Set());
let recording = $state<string | null>(null);

export type Work = 'recording' | 'queued' | null;

export const workOn = (id: string): Work =>
  recording === id ? 'recording' : queue.has(id) ? 'queued' : null;

/** The whole batch, before the first of it is spoken. */
export function queueWork(ids: readonly string[]): void {
  const next = new Set(queue);
  for (const id of ids) next.add(id);
  queue = next;
}

/**
 * build() reporting where it has got to: one sentence is starting, or one has
 * finished — recorded or failed, which the row finds out by looking rather
 * than being told, because "finished" is the only part of it build knows at
 * the same moment for both.
 *
 * The finished half re-reads the sentences instead of announcing the one that
 * landed. `onLanded` existed because `draw()` rebuilt every row from scratch
 * and revoked the blob URL under any `<audio>` playing in another one, so a
 * batch reporting itself cut off a preview each time it moved on. A keyed
 * `{#each}` has no such cost: the rows that did not change are not touched, and
 * the one that did gains its player.
 */
export function stepWork(id: string, done: boolean): void {
  if (queue.has(id)) {
    const next = new Set(queue);
    next.delete(id);
    queue = next;
  }
  if (!done) {
    recording = id;
    return;
  }
  if (recording === id) recording = null;
  void refresh();
}

/** Nothing is being recorded any more — including whatever build() skipped. */
export function endWork(): void {
  queue = new Set();
  recording = null;
}

/** The sentences again, without the Sammlungen: a batch reports one at a time
 *  and nothing about the sidebar has moved. */
export async function refresh(): Promise<void> {
  all = await phrases();
}

export async function load(): Promise<void> {
  const [sentences, made] = await Promise.all([phrases(), loadCollections()]);
  all = sentences;
  declared = made;
  // An open Sammlung survives being emptied — it is still a place. It only
  // goes when the Sammlung itself does.
  const live = new Set([...open].filter((id) => made.some((one) => one.id === id)));
  // There is always somewhere to be. The first one is the one last worked on
  // now that §1.4 orders the list, which is the better answer to "where" than
  // the oldest Sammlung in the library was.
  if (!live.size && made.length) live.add(made[0]!.id);
  setOpen(live);
}

/**
 * Whether the work head's name field is owed the caret.
 *
 * conventions.md §6.5's shape, which is bildhaft's: the controller that makes
 * the Sammlung says the caret is owed, and whichever field takes it says so.
 * What was here instead was a chain — `Collections` took a `nameNew` prop,
 * `App` bound `this` on `WorkHead` and called an exported `focusName()` — which
 * made the producer of a new Sammlung name the consumer of its caret. It also
 * meant the field could only ever be reached from the one component that
 * happened to be bound.
 *
 * A module-scope rune is what makes it reactive: `asked()` is read inside
 * `TitleField`'s effect, so flipping this is what wakes it. `answered()` is
 * said by the field that took the caret, so the next ask is a new one rather
 * than a flag somebody has to remember to clear.
 */
let owed = $state(false);

export const nameCaret = {
  /** „+ Neue Sammlung" made one; its name wants the caret, selected (§1.5). */
  ask: (): void => { owed = true; },
  asked: (): boolean => owed,
  answered: (): void => { owed = false; },
};
