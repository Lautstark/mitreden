/**
 * The steps between versions. One so far, and db.ts says what happens to a
 * version that has none: it is refused, and the library stays as it was.
 */
import type { IDBPTransaction, StoreNames } from 'idb';
import { slug } from '../core/ids.ts';
import { commonest } from '../core/voices.ts';
import { SETTINGS, type MitredenDB, type StoredPhrase } from './schema.ts';

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
 *   arrangement; re-recording would be the silent en-masse rebuild that db.ts
 *   argues against.
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
export async function migrateV3toV4(
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
