/**
 * What the page is currently showing, and who to tell when it changes.
 *
 * The views never reach into each other: they read this and subscribe. That is
 * the whole coupling between the sidebar, the list and the composer.
 */

import { collections as loadCollections, phrases } from '../db/repo.ts';
import { t } from '../i18n/index.ts';
import type { CollectionWithCount, PhraseWithState } from '../core/types.ts';
import { el } from './dom.ts';

/** Not recorded at all — the same question as "which voice?", answered "none". */
export const NO_VOICE = '∅';

/** One Sammlung per picture book adds up fast; the rest is one click away. */
export const CHIP_CAP = 12;

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

/** Which Sammlungen are open, and which voices the chips are filtering to. */
export const OPEN = new Set<string>();
export const VOICE_FILTER = new Set<string>();

const watchers: (() => void)[] = [];
export const subscribe = (fn: () => void): void => { watchers.push(fn); };
export const notify = (): void => { for (const fn of watchers) fn(); };

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

export const voiceOf = (item: PhraseWithState): string =>
  item.state === 'missing' ? NO_VOICE : item.voice ?? NO_VOICE;

/** Search first, then the Sammlung, then the voice. Every axis narrows. */
export function shown(): readonly PhraseWithState[] {
  let list = found();
  if (OPEN.size) list = list.filter((item) => item.collections.some((key) => OPEN.has(key)));
  if (VOICE_FILTER.size) list = list.filter((item) => VOICE_FILTER.has(voiceOf(item)));
  return list;
}

/**
 * Every row names its own voice, so the word "recorded" would be true of all of
 * them and say nothing. Either it is not recorded, or you get the voice.
 */
export const stateText = (item: PhraseWithState): string =>
  item.state === 'missing' ? t('state_missing')
    : item.state === 'stale' ? t('state_stale')
      : item.voice ?? t('state_recorded');

export async function load(): Promise<void> {
  [all, declared] = await Promise.all([phrases(), loadCollections()]);
  // An open Sammlung survives being emptied — it is still a place. It only
  // goes when the Sammlung itself does.
  for (const key of [...OPEN]) if (!declared.some((c) => c.key === key)) OPEN.delete(key);
  // There is always somewhere to be.
  if (!OPEN.size && declared.length) OPEN.add(declared[0]!.key);
  notify();
}
