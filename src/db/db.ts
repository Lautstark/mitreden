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
 * - `updatedAt` — §1.4's order, last edited first. It replaced a `createdAt`
 *   that carried the array's old insertion order, and the change is not just
 *   which field is indexed: creation order was preserved on rename, and this
 *   one is moved by every edit, including the sentences going in and out. See
 *   bump() below for why that half matters more than the rename.
 *
 * ## No migration
 *
 * Version 3 drops every store it finds. conventions.md's rule about its own
 * rules: one user, disposable data, and the old shape deleted in the change
 * that adopts the new one. A library worth keeping across this goes out through
 * the Sicherung, which is what that file is for.
 */

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { normText } from '../core/ids.ts';
import type { Collection, Phrase } from '../core/types.ts';

export interface Settings {
  voice?: string;
  azure?: { key: string; region: string };
}

/** A sentence as the store holds it: the program's shape, plus the index key
 *  that has to be in the record to be an index key. */
type StoredPhrase = Phrase & { norm: string };
/** A Sammlung as the store holds it, plus the stamp §1.4 orders by. */
type StoredCollection = Collection & { updatedAt: number };

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
    /** §1.4's order, and the source of the next stamp: newest is one cursor
     *  step off the far end rather than a scan. */
    indexes: { updatedAt: number };
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
        .createIndex('updatedAt', 'updatedAt');

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
 *
 * The Sammlungen these sentences are in rise to the top of §1.4's order, in the
 * same transaction. Without that the order would only ever move on a rename,
 * which is the one edit nobody does — "what I was last working on" is almost
 * always a sentence that was added, recorded or corrected, and a list claiming
 * to show that while ignoring it would be worse than creation order, because it
 * would look right.
 */
export async function putPhrases(items: readonly Phrase[]): Promise<void> {
  if (!items.length) return;
  const tx = (await db()).transaction(['phrases', 'collections'], 'readwrite');
  const phrases = tx.objectStore('phrases');
  for (const item of items) await phrases.put({ ...item, norm: normText(item.text) });
  await bump(tx, items.flatMap((item) => item.collections));
  await tx.done;
  touched();
}

export const putPhrase = (item: Phrase): Promise<void> => putPhrases([item]);

export async function dropPhrase(id: string): Promise<void> {
  const tx = (await db()).transaction(['phrases', 'collections'], 'readwrite');
  const phrases = tx.objectStore('phrases');
  // Read before the delete: what it was in is the only way to know which
  // Sammlungen just changed, and afterwards there is nothing left to ask.
  const held = await phrases.get(id);
  await phrases.delete(id);
  if (held) await bump(tx, held.collections);
  await tx.done;
  touched();
}

/* ----------------------------------------------------------- collections --- */

/**
 * Moves the named Sammlungen to the top of §1.4's order, inside a transaction
 * somebody else opened.
 *
 * Takes the transaction rather than opening its own, which is the whole reason
 * it is written this way: a sentence landing and its Sammlung rising are one
 * change, and two transactions could leave the second half unwritten. It also
 * has to be *this* transaction because an IndexedDB transaction commits as soon
 * as no request is outstanding on it — awaiting a second one from inside the
 * first is the trap the head of this file describes.
 */
async function bump(
  tx: IDBPTransaction<MitredenDB, ('phrases' | 'collections')[], 'readwrite'>,
  ids: readonly string[],
): Promise<void> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return;
  const collections = tx.objectStore('collections');
  let next = await nextStamp(collections.index('updatedAt'));
  for (const id of wanted) {
    const held = await collections.get(id);
    // A sentence may name a Sammlung that is not here — importBackup keeps an
    // unknown tag on purpose, so that it shows up if that Sammlung ever
    // returns. Nothing to move in that case.
    if (held) await collections.put({ ...held, updatedAt: next++ });
  }
}

const declared = (record: StoredCollection | undefined): Collection | undefined => {
  if (!record) return undefined;
  const { updatedAt: _order, ...collection } = record;
  return collection;
};

/**
 * Last edited first — conventions.md §1.4.
 *
 * Creation order answers a question nobody asks. What the rail is for is
 * getting back to what you were doing, and after a handful of Sammlungen
 * creation order reliably puts that at the bottom.
 *
 * Read off the index and reversed rather than sorted: the index is already in
 * the order, and `prev` on a cursor is the same walk the other way.
 */
export async function allCollections(): Promise<Collection[]> {
  const out: Collection[] = [];
  let cursor = await (await db()).transaction('collections')
    .store.index('updatedAt').openCursor(null, 'prev');
  while (cursor) {
    out.push(declared(cursor.value)!);
    cursor = await cursor.continue();
  }
  return out;
}

export const getCollection = async (id: string): Promise<Collection | undefined> =>
  declared(await (await db()).get('collections', id));

/**
 * The next stamp: now, or one past the highest there is, whichever is later.
 *
 * Date.now() alone is a millisecond clock and the order is supposed to be a
 * total one: two writes inside the same millisecond would sort by nothing, and
 * the list would fall back to whatever the index happens to give. A person
 * cannot click that fast; a test can, and a rule that holds for people and not
 * for machines is one nobody can check. Off the end of the index, so it is one
 * cursor step rather than a scan.
 */
async function nextStamp(index: {
  openKeyCursor(range: null, dir: 'prev'): Promise<{ key: number } | null>;
}): Promise<number> {
  const newest = await index.openKeyCursor(null, 'prev');
  return Math.max(Date.now(), (newest ? newest.key : 0) + 1);
}

/**
 * Writes a Sammlung, and moves it to the top of §1.4's order.
 *
 * A rename is a put too, and it *does* move the Sammlung now, where the
 * creation-ordered version deliberately kept its place. That is the rule
 * changing rather than a detail: editing the name is working on it, and the
 * order is about what was last worked on. The rename is debounced and written
 * on the way out (design/rename), so this is one move per rename rather than
 * one per keystroke.
 */
export async function putCollections(items: readonly Collection[]): Promise<void> {
  if (!items.length) return;
  const tx = (await db()).transaction('collections', 'readwrite');
  // Read once per call rather than once per record: several arriving together
  // have to end up in the order they are given.
  let next = await nextStamp(tx.store.index('updatedAt'));
  for (const item of items) await tx.store.put({ ...item, updatedAt: next++ });
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
