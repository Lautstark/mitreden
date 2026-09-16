/**
 * What the database holds, and the shape it holds it in.
 *
 * Four stores: the sentences, the Sammlungen they sit in, the settings, and the
 * audio. The sentences are the only irreplaceable thing here; the audio can
 * always be made again, and keeping it means a reload does not re-record
 * everything and a voice change only re-records what actually changed.
 *
 * ## Stores, not two arrays under two keys
 *
 * conventions.md §2.1, and mitreden was the last product diverging from it.
 * This database used `idb` from the day it was written — the library was never
 * the problem — but it kept the whole library as two JSON arrays in a `meta`
 * store, one under `phrases` and one under `collections`. So it had the library
 * it declared and none of what the library is for:
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
 *   and migrations.ts — so the index is an ordinary one.
 * - **A count meant loading every sentence.** §1.8 wants one in every sidebar
 *   row; it is `index.count(key)` now and touches no records at all.
 * - **"Is there already a sentence like this?" was a linear scan** on every
 *   line of an import. It is an index lookup.
 *
 * ## Two fields the stores need that the program does not
 *
 * An index needs its key to be *in* the record, and two of the things this
 * database sorts and looks up by are not fields anybody outside db/ has ever
 * needed. So they live in the stored record and are stripped on the way out:
 * `Phrase` and `Collection` in core/types.ts are unchanged, nothing above db/
 * knows they exist, and no backup carries them.
 *
 * - `norm` — the normalised text, for the twin lookup. Derived from `text`, so
 *   it can go stale; that is why it is written in exactly one place,
 *   putPhrases() in phrases.ts, rather than by each caller that happens to
 *   build a Phrase. Same reasoning as the change notifier: a derived field with
 *   three writers is a derived field that is wrong by next year.
 * - `updatedAt` — §1.4's order, last edited first. It replaced a `createdAt`
 *   that carried the array's old insertion order, and the change is not just
 *   which field is indexed: creation order was preserved on rename, and this
 *   one is moved by every edit, including the sentences going in and out. See
 *   bump() in collections.ts for why that half matters more than the rename.
 */
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Collection, Phrase } from '../core/types.ts';

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
export type StoredPhrase = Phrase & { norm: string };
/** A Sammlung as the store holds it, plus the stamp §1.4 orders by. */
export type StoredCollection = Collection & { updatedAt: number };

export const SETTINGS = 'settings';

export interface MitredenDB extends DBSchema {
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

/** The stores a database that has never been here starts with. */
export function createStores(database: IDBPDatabase<MitredenDB>): void {
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
