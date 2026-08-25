/**
 * Everything that is kept, and where.
 *
 * Four stores: the sentences, the Sammlungen they sit in, the settings, and the
 * audio. The sentences are the only irreplaceable thing here; the audio can
 * always be made again, and keeping it means a reload does not re-record
 * everything and a voice change only re-records what actually changed.
 *
 * ## Stores, not two arrays under two keys
 *
 * conventions.md §2.1, and mitreden was the last product diverging from it.
 * This file used `idb` from the day it was written — the library was never the
 * problem — but it kept the whole library as two JSON arrays in a `meta` store,
 * one under `phrases` and one under `collections`. So it had the library it
 * declared and none of what the library is for:
 *
 * - **Every read was a whole-library read and every write a whole-library
 *   write.** Recording two hundred sentences rewrote a two-hundred-entry array
 *   two hundred times, once per sentence, because `build()` saves after each
 *   one so the row can be found the moment it is announced.
 * - **"The sentences in this Sammlung" was a filter over everything.** It is a
 *   query now: `collections` is a multiEntry index, so a Sammlung's members are
 *   a range the database walks. That index is the one this product needs most,
 *   because arity here is *many* (§4.1) — a sentence belongs to the morning
 *   Sammlung and the nursery one at once, which is exactly the shape a
 *   multiEntry index exists for and exactly the shape a filter is worst at.
 * - **A count meant loading every sentence.** §1.8 wants one in every sidebar
 *   row; it is `index.count(key)` now and touches no records at all.
 * - **"Is there already a sentence like this?" was a linear scan** on every
 *   line of an import. It is an index lookup.
 *
 * ## Two fields the stores need that the program does not
 *
 * An index needs its key to be *in* the record, and two of the things this
 * database sorts and looks up by are not fields anybody outside here has ever
 * needed. So they live in the stored record and are stripped on the way out:
 * `Phrase` and `Collection` in core/types.ts are unchanged, nothing above this
 * file knows they exist, and no backup carries them.
 *
 * - `norm` — the normalised text, for the twin lookup. Derived from `text`, so
 *   it can go stale; that is why it is written in exactly one place, `put`
 *   below, rather than by each caller that happens to build a Phrase. Same
 *   reasoning as the change notifier: a derived field with three writers is a
 *   derived field that is wrong by next year.
 * - `createdAt` — the order the Sammlungen were made, which was the array's
 *   insertion order and is nothing at all once each is a record of its own.
 *   Preserved on rename rather than re-stamped, because renaming is not making.
 *
 * §1.4 (last-edited-first) is still open here and is deliberately not done in
 * this change: it is a different divergence, and the honest move was to keep
 * the order this product has rather than smuggle a second decision in. It is
 * now a second index away rather than a rewrite.
 *
 * ## No migration
 *
 * Version 2 drops every store it finds. conventions.md's rule about its own
 * rules: one user, disposable data, and the old shape deleted in the change
 * that adopts the new one. A library worth keeping across this goes out through
 * the Sicherung, which is what that file is for.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { normText } from '../core/ids.ts';
import type { Collection, Phrase } from '../core/types.ts';

export interface Settings {
  voice?: string;
  azure?: { key: string; region: string };
}

/** A sentence as the store holds it: the program's shape, plus the index key
 *  that has to be in the record to be an index key. */
type StoredPhrase = Phrase & { norm: string };
/** A Sammlung as the store holds it, plus the stamp that carries the order the
 *  array used to carry for free. */
type StoredCollection = Collection & { createdAt: number };

const SETTINGS = 'settings';

interface MitredenDB extends DBSchema {
  phrases: {
    key: string;
    value: StoredPhrase;
    indexes: {
      /** multiEntry: one entry per Sammlung the sentence is in, which is what
       *  makes membership a query in the one product where a sentence can be
       *  in several (§4.1). */
      collections: string;
      /** The twin lookup. Not unique: nothing has ever stopped two sentences
       *  normalising alike — editPhrase() does not check — so this finds *a*
       *  twin, which is all the callers ever wanted. */
      norm: string;
    };
  };
  collections: {
    key: string;
    value: StoredCollection;
    indexes: { createdAt: number };
  };
  settings: { key: typeof SETTINGS; value: Settings };
  audio: { key: string; value: Blob };
}

/* ---------------------------------------------------------------- change --- */

/*
 * Every write that changes what a Sicherung would contain says so here, and
 * the standing backup listens.
 *
 * The alternative was calling schedule() from each place in the interface that
 * edits something, and it is the wrong shape: the next one would be added by
 * somebody who had never heard of the backup, nothing would fail, and the
 * library would quietly stop being saved. That is this feature's entire
 * failure mode, so the notifier sits at the writes instead.
 *
 * putAudio and dropAudio deliberately do NOT announce. Recordings are not in
 * the backup — they are reproducible, and they are three orders of magnitude
 * the size — so a build of two hundred sentences would otherwise rewrite the
 * file two hundred times to say nothing new.
 */
const watchers = new Set<() => void>();

export function onChanged(listener: () => void): () => void {
  watchers.add(listener);
  return () => watchers.delete(listener);
}

function touched(): void {
  for (const listener of watchers) listener();
}

let handle: Promise<IDBPDatabase<MitredenDB>> | null = null;

export function db(): Promise<IDBPDatabase<MitredenDB>> {
  handle ??= openDB<MitredenDB>('mitreden', 3, {
    upgrade(database) {
      // Snapshotted before the loop: objectStoreNames is live, and deleting
      // through it skips every other name.
      for (const name of [...database.objectStoreNames]) database.deleteObjectStore(name);

      const phrases = database.createObjectStore('phrases', { keyPath: 'id' });
      phrases.createIndex('collections', 'collections', { multiEntry: true });
      phrases.createIndex('norm', 'norm');

      database.createObjectStore('collections', { keyPath: 'id' })
        .createIndex('createdAt', 'createdAt');

      // Out-of-line: a Settings object has no id of its own, and a Blob cannot
      // carry one.
      database.createObjectStore(SETTINGS);
      database.createObjectStore('audio');
    },
  });
  return handle;
}

/* --------------------------------------------------------------- phrases --- */

/** The program's shape, without the index key this file added. */
const shown = (record: StoredPhrase | undefined): Phrase | undefined => {
  if (!record) return undefined;
  const { norm: _index, ...phrase } = record;
  return phrase;
};

/** Every sentence. Named for what it costs: this is the whole-library read,
 *  and it has three honest callers — the list, the export and the Sicherung,
 *  all of which are about all of them. */
export async function allPhrases(): Promise<Phrase[]> {
  return (await (await db()).getAll('phrases')).map((r) => shown(r)!);
}

/** The sentences in one Sammlung, off the index rather than by filtering. */
export async function phrasesIn(id: string): Promise<Phrase[]> {
  return (await (await db()).getAllFromIndex('phrases', 'collections', id))
    .map((r) => shown(r)!);
}

/** How many are in one, without loading any of them. §1.8's row count. */
export const countIn = async (id: string): Promise<number> =>
  (await db()).countFromIndex('phrases', 'collections', id);

/** How many there are at all. The delete-everything question asks this. */
export const countPhrases = async (): Promise<number> => (await db()).count('phrases');

export const getPhrase = async (id: string): Promise<Phrase | undefined> =>
  shown(await (await db()).get('phrases', id));

/**
 * A sentence like this one, or nothing. "Like" is normText's answer:
 * punctuation stays in, because "Nochmal!" and "Nochmal." are spoken
 * differently.
 */
export async function twinOf(text: string): Promise<Phrase | undefined> {
  return shown(await (await db()).getFromIndex('phrases', 'norm', normText(text)));
}

/** Whether a sentence already has this id. A key lookup, not a scan — and the
 *  question rather than the answer, because a caller adding several at once has
 *  to count the ones it has not written yet. See free() in core/ids.ts. */
export const idTaken = async (id: string): Promise<boolean> =>
  (await (await db()).getKey('phrases', id)) !== undefined;

/**
 * Writes sentences, all of them or none.
 *
 * One transaction rather than one per sentence: an import of six hundred lines
 * that fails partway used to leave the array untouched, and leaving half a file
 * in the library would have been a regression dressed as an improvement.
 *
 * `norm` is stamped here and nowhere else — see the head of this file.
 */
export async function putPhrases(items: readonly Phrase[]): Promise<void> {
  if (!items.length) return;
  const tx = (await db()).transaction('phrases', 'readwrite');
  for (const item of items) await tx.store.put({ ...item, norm: normText(item.text) });
  await tx.done;
  touched();
}

export const putPhrase = (item: Phrase): Promise<void> => putPhrases([item]);

export async function dropPhrase(id: string): Promise<void> {
  await (await db()).delete('phrases', id);
  touched();
}

/* ----------------------------------------------------------- collections --- */

const declared = (record: StoredCollection | undefined): Collection | undefined => {
  if (!record) return undefined;
  const { createdAt: _order, ...collection } = record;
  return collection;
};

/** In the order they were made, which is the order this product shows them in.
 *  Off the index; the array used to carry it as insertion order. */
export async function allCollections(): Promise<Collection[]> {
  return (await (await db()).getAllFromIndex('collections', 'createdAt'))
    .map((r) => declared(r)!);
}

export const getCollection = async (id: string): Promise<Collection | undefined> =>
  declared(await (await db()).get('collections', id));

/**
 * Writes a Sammlung, keeping the order it was made in.
 *
 * A rename is a put too, and it must not move the Sammlung in the list —
 * renaming is not making — so an existing record's stamp is read and kept.
 *
 * A new one gets now, or one past the highest there is, whichever is later.
 * Date.now() alone is a millisecond clock and the order is supposed to be a
 * total one: two made inside the same millisecond would sort by nothing, and
 * the list would fall back to whatever the index happens to give — which is the
 * order this is here to preserve. A person cannot click that fast; a test can,
 * and a rule that holds for people and not for machines is one nobody can
 * check. Off the end of the index, so it is one cursor step rather than a scan.
 */
export async function putCollections(items: readonly Collection[]): Promise<void> {
  if (!items.length) return;
  const tx = (await db()).transaction('collections', 'readwrite');
  // Read once per call rather than once per record: several arriving together
  // are several new ones, and they have to end up in the order they are given.
  const newest = await tx.store.index('createdAt').openKeyCursor(null, 'prev');
  let next = Math.max(Date.now(), (newest ? newest.key : 0) + 1);
  for (const item of items) {
    const held = await tx.store.get(item.id);
    await tx.store.put({ ...item, createdAt: held ? held.createdAt : next++ });
  }
  await tx.done;
  touched();
}

export const putCollection = (item: Collection): Promise<void> => putCollections([item]);

/**
 * The Sammlung goes, the sentences stay: they are the irreplaceable half, and
 * §4.3 says so — mitreden drops only the membership where bildhaft and vorlaut
 * delete the contents.
 *
 * One transaction over both stores, and only over the sentences that are
 * actually in it. The array version walked every sentence in the library to
 * strip a key from the few that had it; the index says which few.
 */
export async function dropCollection(id: string): Promise<boolean> {
  const tx = (await db()).transaction(['collections', 'phrases'], 'readwrite');
  const collections = tx.objectStore('collections');
  if (!(await collections.get(id))) {
    await tx.done;
    return false;
  }
  await collections.delete(id);

  const phrases = tx.objectStore('phrases');
  for (const member of await phrases.index('collections').getAll(id)) {
    await phrases.put({ ...member, collections: member.collections.filter((k) => k !== id) });
  }
  await tx.done;
  touched();
  return true;
}

/* -------------------------------------------------------------- the rest --- */

export async function loadSettings(): Promise<Settings> {
  return (await (await db()).get(SETTINGS, SETTINGS)) ?? {};
}

export async function saveSettings(value: Settings): Promise<void> {
  await (await db()).put(SETTINGS, value, SETTINGS);
  touched();
}

export const getAudio = async (id: string): Promise<Blob | undefined> =>
  (await db()).get('audio', id);
export const putAudio = async (id: string, blob: Blob): Promise<void> => {
  await (await db()).put('audio', blob, id);
};
export const dropAudio = async (id: string): Promise<void> => {
  await (await db()).delete('audio', id);
};

/** Everything, gone: every store, for the settings dialog's last button. */
export async function wipe(): Promise<void> {
  const database = await db();
  await Promise.all([
    database.clear('phrases'),
    database.clear('collections'),
    database.clear(SETTINGS),
    database.clear('audio'),
  ]);
  touched();
}
