/**
 * The steps between versions. Two so far, and db.ts says what happens to a
 * version that has none: it is refused, and the library stays as it was.
 *
 * A database crossing several versions runs every step in between, in order,
 * inside the one versionchange transaction — so each step here is written
 * against the shape the step above it leaves, and never against the shape the
 * program currently has.
 */
import type { IDBPTransaction, StoreNames } from 'idb';
import { slug } from '../core/ids.ts';
import { commonest } from '../core/voices.ts';
import { SETTINGS, type MitredenDB, type Settings, type StoredPhrase } from './schema.ts';

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

/**
 * The settings record as version 4 left it: the collapse preference is called
 * `railOpen`.
 *
 * Declared here rather than anywhere the program can reach, for `PhraseV3`'s
 * reason — the old name exists in exactly one place now, and this is it.
 */
type SettingsV4 = Omit<Settings, 'sidebarOpen'> & { railOpen?: boolean };

/**
 * Version 4 to version 5: `railOpen` becomes `sidebarOpen`.
 *
 * One field of one record of one store, and the whole of the change. It is a
 * rename rather than a new preference: the polarity is the same (`true` is a
 * column that is there, absent is open), and the value stored is carried
 * across rather than defaulted, so somebody who put the sidebar away last week
 * finds it still away.
 *
 * **Why this is a step and not a read-side fallback.** `patchSettings` merges,
 * so a key nothing writes any more is a key nothing ever removes: without this
 * every existing browser would carry a dead `railOpen` beside the live
 * `sidebarOpen` for the life of the database, and the first person to read the
 * record would have two answers to one question and no way to tell which one
 * the program uses. The alternative — `saved.sidebarOpen ?? saved.railOpen` at
 * the reader — is the same debt with a second copy of the old name in the
 * source as interest.
 *
 * **And why the rename was worth a version at all.** The field is named for
 * the element it remembers, and that element is
 * `@lautstark/design/svelte/Sidebar` now (conventions.md §6.3): there is no
 * `.rail` left in this product for `railOpen` to be about. Nothing leaves the
 * browser over it — `stripSecrets` in backup.ts is an allow-list and carries
 * `voice` alone — so no Sicherung, no export and no other product has to know
 * this happened.
 *
 * Every await here is on an IndexedDB request, for the reason migrateV3toV4
 * gives at length: one await on anything else commits the transaction halfway.
 */
export async function migrateV4toV5(
  tx: IDBPTransaction<MitredenDB, StoreNames<MitredenDB>[], 'versionchange'>,
): Promise<void> {
  const store = tx.objectStore(SETTINGS);
  const held = (await store.get(SETTINGS)) as SettingsV4 | undefined;
  // No record at all is the ordinary case for a browser that has never changed
  // a preference, and a record without the key is one that never collapsed it.
  // Both are already the new shape.
  if (!held || held.railOpen === undefined) return;

  const { railOpen, ...rest } = held;
  await store.put({ ...rest, sidebarOpen: railOpen }, SETTINGS);
}
