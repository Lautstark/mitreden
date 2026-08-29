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
 *   query now: `collection` is an index, so a Sammlung's members are a range
 *   the database walks. It was a *multiEntry* index until version 4, because
 *   arity here was many (§4.1) and a sentence belonged to the morning Sammlung
 *   and the nursery one at once. It belongs to one now — see Phrase.collection
 *   and the migration below — so the index is an ordinary one.
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
 * ## Migration: a step for every version crossed, or nothing happens
 *
 * Version 4 carries a version 3 library across, recordings and all: `migrate`
 * below copies blobs where it splits a sentence and deletes none. Nothing is
 * re-recorded and nothing is lost.
 *
 * Every other old version is **refused**, and the upgrade transaction is
 * aborted so the database keeps its version and its records. That is a change
 * of rule, and it is worth saying what it replaced. This file used to drop
 * every store it found for anything older than 3, on conventions.md's rule
 * about its own rules: one user, disposable data, and the old shape deleted in
 * the change that adopts the new one. A library worth keeping went out through
 * the Sicherung.
 *
 * That rule stopped being true when this went to a domain. "One user" is not
 * one browser: versions 1 and 2 were live between 2026-08-22 and 2026-08-25,
 * and a browser still holding one is a browser that has not been back since —
 * which is exactly the browser that would have lost its library on the next
 * visit, silently, to a page that then worked perfectly. bildhaft reached the
 * same place first and wrote it down; its adr/0001 is the argument, and this
 * is mitreden agreeing with it.
 *
 * Version 4 itself already conceded the principle. The reason it carries a v3
 * library rather than asking for it back is that re-recording a library *in a
 * new arrangement* is the thing a person would want to check before agreeing
 * to — and "the audio is reproducible" is cheap to say and expensive to do. A
 * v1 or v2 library is no more disposable than a v3 one; it is only older.
 *
 * What a refusal costs is that the app cannot open until somebody decides. It
 * says so, and offers to start again — the same discard as before, made once,
 * out loud, by the person whose recordings they are. A step can still be
 * written later; the refusal is what keeps the records alive long enough for
 * that to be possible.
 */

import {
  deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames,
} from 'idb';
import { normText, slug } from '../core/ids.ts';
import { commonest } from '../core/voices.ts';
import type { Collection, Phrase } from '../core/types.ts';
import { changes } from '@lautstark/werkzeuge/changed';

export interface Settings {
  azure?: { key: string; region: string };
  /**
   * The voice the next Sammlung is made with — and, until one is made, the voice
   * a Sammlung that has none records in. It used to be the voice the next
   * *sentence* was recorded in; the field is the same and what it is the default
   * for has moved out one level. See Collection.voice.
   */
  voice?: string;
  /**
   * Which Sammlungen are open — a set, not one. Several can be open at once and
   * "where I was" is all of them (§4.2, and conventions.md §1.2). That is about
   * the open set and not about arity: a sentence is in one Sammlung now, and
   * opening the morning one and the nursery one together still shows the union
   * of the two.
   */
  open?: string[];
  /**
   * Whether the rail is a column of the page at all. A desktop choice; the
   * phone has no rail to collapse, only one to dismiss. conventions.md §1.3.
   */
  railOpen?: boolean;
  /**
   * What the Anybook export was asked for last time.
   *
   * `next` is where the last run ended, offered as the starting point for the
   * one after it — a guess and never a claim. Nothing here can know which
   * stickers were actually printed, let alone which were peeled, so it is a
   * pre-selection the dialog shows and one click moves. Being right most of the
   * time and visibly wrong the rest beats starting at one on every part-used
   * sheet.
   */
  pen?: { sheet: string; next: number };
  /**
   * Which scheme the stored fingerprints are named under — db/rekey.ts, which
   * owns the number and the pass that moves it.
   *
   * Absent means the scheme this page used before it asked stimmquelle for
   * CONTRACT.md §3 rather than assembling it here.
   */
  keyScheme?: number;
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
      /** The Sammlung it is in, so membership is a query rather than a filter.
       *  A sentence in none carries no key here at all, which is what IndexedDB
       *  does with an absent key path — and is right: nothing ever asks the
       *  index for the uncollected ones. */
      collection: string;
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
 *
 * The Set behind it is @lautstark/werkzeuge/changed's now; three products had
 * written the same ten lines. What stays here is the rule above, which is the
 * part that is about mitreden — which writes announce and which two do not.
 */
const changed = changes();
export const onChanged = changed.onChanged;
const touched = changed.touched;

/**
 * The library as version 3 left it: a sentence names every Sammlung it is in.
 *
 * Only ever seen inside the migration, so it is declared here rather than kept
 * anywhere the program can reach. `collections` is the whole of the difference.
 */
type PhraseV3 = Omit<StoredPhrase, 'collection'> & { collections?: string[] };

/**
 * Version 3 to version 4: the voice moves to the Sammlung, and a sentence stops
 * being in several.
 *
 * Every await in here is on an IndexedDB request and nothing else. A
 * versionchange transaction commits the moment control reaches the event loop
 * with no request outstanding, so one `await` on a promise from elsewhere — a
 * fetch, or `crypto.subtle.digest` — would commit this halfway through and
 * leave a half-migrated library behind. That is why no fingerprint is taken
 * here: none needs to be. A split sentence copies the fingerprint it already
 * had, because it is a copy of the same text recorded in the same voice.
 *
 * What each shape becomes:
 *
 * - **In one Sammlung.** `collections: [a]` becomes `collection: a`. The row
 *   keeps its id, its voice, its fingerprint and its recording; nothing is
 *   touched but the field name.
 * - **In none.** Stays in none. It is a real state (composer.ts makes one every
 *   time two Sammlungen are open) and it records in the settings voice.
 * - **In several.** The row stays in the *first* — the Sammlung it was
 *   originally added to, since every later entry was pushed on by the twin
 *   merge that this change removes. It keeps its id, which matters more than it
 *   looks: the id is a file name, and the file may already be on a talker. Each
 *   further Sammlung gets a row of its own, with a fresh numbered id, the same
 *   text, and a **copy of the clip** — so the sentence is still recorded, in
 *   the same voice, in both places. Moving it would empty one Sammlung the
 *   person never asked to empty; dropping the extra membership would lose the
 *   arrangement; re-recording would be the silent en-masse rebuild that this
 *   whole file argues against.
 * - **Naming a Sammlung that is not here.** Kept, exactly as before: a restored
 *   backup deliberately keeps an unknown tag so the sentence reappears if that
 *   Sammlung ever comes back.
 *
 * And each Sammlung takes the voice its sentences were actually recorded in —
 * `commonest`, so the reading that leaves the fewest of them stale wins. One
 * whose sentences disagree makes the minority stale, which is a true statement
 * about them and not a loss: every clip is still there and still plays.
 * One with nothing to vote with is left without a voice and follows the
 * settings default, which is what it was doing before this change anyway.
 */
async function migrate(
  tx: IDBPTransaction<MitredenDB, StoreNames<MitredenDB>[], 'versionchange'>,
): Promise<void> {
  const store = tx.objectStore('phrases');
  store.deleteIndex('collections' as 'collection');
  store.createIndex('collection', 'collection');

  const held = (await store.getAll()) as PhraseV3[];
  const audio = tx.objectStore('audio');

  /* Ids taken, so a split row is numbered the way free() in core/ids.ts numbers
     — against what is already stored *and* against what this loop has minted so
     far. free() itself is not used: it is async, and an await on its predicate
     is an await on something that is not a request. */
  const taken = new Set(held.map((one) => one.id));
  const mint = (text: string): string => {
    const base = slug(text);
    if (!taken.has(base)) { taken.add(base); return base; }
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
    }
  };

  /** Which voices were used in each Sammlung, for the vote below. */
  const votes = new Map<string, (string | undefined)[]>();
  const vote = (id: string, voice: string | undefined): void => {
    const list = votes.get(id) ?? [];
    list.push(voice);
    votes.set(id, list);
  };

  for (const was of held) {
    const { collections = [], ...rest } = was;
    const [first, ...also] = collections;
    const stays: StoredPhrase = first === undefined ? rest : { ...rest, collection: first };
    await store.put(stays);
    if (first !== undefined) vote(first, was.voice);

    if (!also.length) continue;
    // Read once for all the copies rather than once each: they are the same
    // clip, and a Blob handed to several put()s is stored once per key anyway.
    const clip = await audio.get(was.id);
    for (const id of also) {
      const copy: StoredPhrase = { ...rest, id: mint(was.text), collection: id };
      await store.put(copy);
      if (clip) await audio.put(clip, copy.id);
      vote(id, was.voice);
    }
  }

  const preferred = (await tx.objectStore(SETTINGS).get(SETTINGS))?.voice;
  const collections = tx.objectStore('collections');
  for (const collection of await collections.getAll()) {
    const voice = commonest(votes.get(collection.id) ?? [], preferred);
    if (voice) await collections.put({ ...collection, voice });
  }
}

/** The stores a database that has never been here starts with. */
function createStores(database: IDBPDatabase<MitredenDB>): void {
  const phrases = database.createObjectStore('phrases', { keyPath: 'id' });
  phrases.createIndex('collection', 'collection');
  phrases.createIndex('norm', 'norm');

  database.createObjectStore('collections', { keyPath: 'id' })
    .createIndex('updatedAt', 'updatedAt');

  // Out-of-line: a Settings object has no id of its own, and a Blob cannot
  // carry one.
  database.createObjectStore(SETTINGS);
  database.createObjectStore('audio');
}

/**
 * Thrown when a database has to cross a version nothing here knows how to
 * carry. A code rather than a sentence: this file has no language, and the
 * caller has the text table. What it means at the call site is *the library is
 * still there and nothing has touched it.*
 */
export const MISSING_STEP = 'db:no-migration';

/** Whether an error is the refusal above, wherever it surfaced. */
export const isRefusal = (error: unknown): boolean =>
  error instanceof Error && error.message === MISSING_STEP;

/**
 * Why the last open refused, put aside where db() can pick it up.
 *
 * A throw does not abort an *async* upgrade callback the way it aborts a
 * synchronous one: the rejection escapes into nothing idb is watching and the
 * transaction commits regardless. So the refusal is an explicit abort(), and
 * the reason has to travel out of band — what openDB rejects with is an
 * AbortError, which says nothing about why.
 */
let refusal: Error | null = null;

let handle: Promise<IDBPDatabase<MitredenDB>> | null = null;

export function db(): Promise<IDBPDatabase<MitredenDB>> {
  refusal = null;
  handle ??= openDB<MitredenDB>('mitreden', 4, {
    async upgrade(database, from, _to, tx) {
      try {
        // A browser that has never been here — and the way back in after
        // discardEverything(), which deletes the database and so arrives as
        // this same case.
        if (from === 0) {
          createStores(database);
          return;
        }

        // A version 3 library is carried across, recordings and all.
        if (from === 3) {
          await migrate(tx);
          return;
        }

        // Every other version, including any added after this one without a
        // step to go with it. Refusing is the whole point: see the head of
        // this file.
        throw new Error(MISSING_STEP);
      } catch (error) {
        refusal = error instanceof Error ? error : new Error(MISSING_STEP);
        // The abort rejects tx.done, and nothing else is listening to it.
        tx.done.catch(() => undefined);
        tx.abort();
      }
    },
  }).catch((error: unknown) => {
    // Let the next call try again rather than caching a rejected promise — the
    // one after a discard has to be able to succeed.
    handle = null;
    throw refusal ?? error;
  });
  return handle;
}

/**
 * Deletes the database outright, for the one case that cannot be answered any
 * other way: a library this version has no step for, whose owner has been told
 * what it is and has asked to start again anyway. Nothing else in the program
 * calls this — wipe() empties the stores of a database that opens.
 */
export async function discardEverything(): Promise<void> {
  handle = null;
  await deleteDB('mitreden');
  touched();
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
  return (await (await db()).getAllFromIndex('phrases', 'collection', id))
    .map((r) => shown(r)!);
}

/** How many are in one, without loading any of them. §1.8's row count. */
export const countIn = async (id: string): Promise<number> =>
  (await db()).countFromIndex('phrases', 'collection', id);

/** How many there are at all. The delete-everything question asks this. */
export const countPhrases = async (): Promise<number> => (await db()).count('phrases');

export const getPhrase = async (id: string): Promise<Phrase | undefined> =>
  shown(await (await db()).get('phrases', id));

/**
 * Every sentence like this one. "Like" is normText's answer: punctuation stays
 * in, because "Nochmal!" and "Nochmal." are spoken differently.
 *
 * All of them rather than one. It handed back the first until arity changed,
 * and the first is no longer enough to answer with: the same text may sit in
 * two Sammlungen as two rows now, and what a caller wants to know is whether
 * one of them is in the Sammlung it is adding to. The index was never unique —
 * editPhrase() has always been able to make two rows normalise alike — so this
 * is the honest shape of the question.
 */
export async function twinsOf(text: string): Promise<Phrase[]> {
  return (await (await db()).getAllFromIndex('phrases', 'norm', normText(text)))
    .map((r) => shown(r)!);
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
  await bump(tx, items.map((item) => item.collection));
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
  if (held) await bump(tx, [held.collection]);
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
  ids: readonly (string | undefined)[],
): Promise<void> {
  // A sentence in no Sammlung moves nothing, and that is not a special case to
  // guard against — it is one of the ids being absent.
  const wanted = [...new Set(ids)].filter((id) => id !== undefined);
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
  for (const member of await phrases.index('collection').getAll(id)) {
    const { collection: _gone, ...rest } = member;
    await phrases.put(rest);
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
