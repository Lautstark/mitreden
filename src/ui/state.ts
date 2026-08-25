/**
 * What the page is currently showing, and who to tell when it changes.
 *
 * The views never reach into each other: they read this and subscribe. That is
 * the whole coupling between the sidebar, the list and the composer.
 */

import { collections as loadCollections, phrases, saveOpen, settings } from '../db/repo.ts';
import { t } from '../i18n/index.ts';
import type { CollectionWithCount, PhraseWithState } from '../core/types.ts';
import { el } from './dom.ts';

/**
 * Rendering thousands of rows makes the page crawl and nobody reads that far.
 * Counts and downloads always cover everything that matches, not just what is
 * drawn.
 */
export const CAP = 200;

let all: PhraseWithState[] = [];
let declared: CollectionWithCount[] = [];

export const ALL = (): readonly PhraseWithState[] => all;
export const DECLARED = (): readonly CollectionWithCount[] => declared;

/** Which Sammlungen are open. */
export const OPEN = new Set<string>();

/**
 * The last set written, so that a repaint does not rewrite it.
 *
 * notify() runs for every change on the page and most of them have nothing to
 * do with which Sammlung is open. Writing the settings record each time would
 * be harmless in the store and loud everywhere else: saveSettings announces a
 * change through db.ts's notifier, so the standing backup would reschedule
 * itself on every keystroke that redraws a row.
 */
let remembered: string | null = null;

/**
 * Whatever is open, kept in the settings record — conventions.md §1.2, and the
 * whole set rather than one of them, because arity here is many (§4.1) and
 * "where I was" is all of the places I was.
 *
 * Called from notify() and load() rather than from each of the four places that
 * change OPEN. Same shape as db.ts's touched(), and for the same reason: the
 * fifth caller is written by somebody who has never heard of this.
 */
function rememberOpen(): void {
  const now = [...OPEN].join('\u0000');
  if (now === remembered) return;
  remembered = now;
  void saveOpen([...OPEN]);
}

/**
 * What was open last time, before anything is drawn.
 *
 * Ids that no longer name a Sammlung are dropped here rather than trusted: the
 * record is written by a page that had them and read by one that may not — a
 * restore, a wipe, or a Sammlung deleted in another tab.
 */
export async function restoreOpen(): Promise<void> {
  const held = (await settings()).open ?? [];
  OPEN.clear();
  for (const id of held) OPEN.add(id);
  // Not a write: this is what was read, so remembering it stops load() writing
  // the same set straight back.
  remembered = [...OPEN].join('\u0000');
}

const watchers: (() => void)[] = [];
export const subscribe = (fn: () => void): void => { watchers.push(fn); };
export const notify = (): void => {
  rememberOpen();
  for (const fn of watchers) fn();
};

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
  `${bare(item.text)} | ${umlaut(item.text)} | ${item.collections.join(' ')}`;

export function found(): readonly PhraseWithState[] {
  const query = el<HTMLInputElement>('q').value.trim();
  if (!query) return all;
  const a = bare(query);
  const b = umlaut(query);
  return all.filter((item) => {
    const hay = haystack(item);
    return hay.includes(a) || hay.includes(b);
  });
}

/**
 * Search first, then the Sammlung. There was a third axis — a row of pills
 * narrowing to one voice — and it was answering a question nobody had: every
 * row already names its own voice, and a Sammlung is small enough to read.
 */
export function shown(): readonly PhraseWithState[] {
  const list = found();
  return OPEN.size
    ? list.filter((item) => item.collections.some((id) => OPEN.has(id)))
    : list;
}

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
const queue = new Set<string>();
let recording: string | null = null;

export type Work = 'recording' | 'queued' | null;

export const workOn = (id: string): Work =>
  recording === id ? 'recording' : queue.has(id) ? 'queued' : null;

/** Its own watchers, and not notify(): a full redraw is too much to pay per
 *  sentence. It revokes every blob URL, so a preview playing in another row
 *  would stop each time the batch moved on. */
const workWatchers: (() => void)[] = [];
export const onWork = (fn: () => void): void => { workWatchers.push(fn); };
const toldWork = (): void => { for (const fn of workWatchers) fn(); };

/** Told about the one sentence that just gained a recording, by id. */
const landedWatchers: ((id: string) => void)[] = [];
export const onLanded = (fn: (id: string) => void): void => { landedWatchers.push(fn); };

/** The whole batch, before the first of it is spoken. */
export function queueWork(ids: readonly string[]): void {
  for (const id of ids) queue.add(id);
  toldWork();
}

/**
 * build() reporting where it has got to: one sentence is starting, or one has
 * finished — recorded or failed, which the row finds out by looking rather
 * than being told, because "finished" is the only part of it build knows at
 * the same moment for both.
 */
export function stepWork(id: string, done: boolean): void {
  queue.delete(id);
  if (!done) {
    recording = id;
    toldWork();
    return;
  }
  // No toldWork() here: the row is about to be redrawn from fresh data, and
  // repainting it first would flash the state it had before it was recorded.
  if (recording === id) recording = null;
  for (const fn of landedWatchers) fn(id);
}

/** Nothing is being recorded any more — including whatever build() skipped. */
export function endWork(): void {
  queue.clear();
  recording = null;
  toldWork();
}

/**
 * The sentences again, without telling anyone. A batch reports one at a time
 * and each report is about a single row, so the list re-reads and repaints
 * that row itself; notify() here would redraw all of them.
 */
export async function refresh(): Promise<void> {
  all = await phrases();
}

/**
 * Every row names its own voice, so the word "recorded" would be true of all of
 * them and say nothing. Either it is not recorded, or you get the voice — and
 * before either of those, whether it is being recorded right now.
 */
export const stateText = (item: PhraseWithState): string => {
  const work = workOn(item.id);
  if (work) return t(work === 'recording' ? 'state_recording' : 'state_queued');
  return item.state === 'missing' ? t('state_missing')
    : item.state === 'stale' ? t('state_stale')
      : item.voice ?? t('state_recorded');
};

export async function load(): Promise<void> {
  [all, declared] = await Promise.all([phrases(), loadCollections()]);
  // An open Sammlung survives being emptied — it is still a place. It only
  // goes when the Sammlung itself does.
  for (const id of [...OPEN]) if (!declared.some((c) => c.id === id)) OPEN.delete(id);
  // There is always somewhere to be. The first one is the one last worked on
  // now that §1.4 orders the list, which is the better answer to "where" than
  // the oldest Sammlung in the library was.
  if (!OPEN.size && declared.length) OPEN.add(declared[0]!.id);
  // notify() is what writes the set; nothing here has to remember to.
  notify();
}
