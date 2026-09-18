/* ----------------------------------------------------------- collections --- */
import type { IDBPTransaction } from 'idb';
import type { Collection } from '../core/types.ts';
import { fileCollection, unfileCollection } from './folder.ts';
import { db, touched } from './db.ts';
import { mirror } from './mirror.ts';
import type { MitredenDB, StoredCollection } from './schema.ts';

/**
 * Moves the named Sammlungen to the top of §1.4's order, inside a transaction
 * somebody else opened.
 *
 * Takes the transaction rather than opening its own, which is the whole reason
 * it is written this way: a sentence landing and its Sammlung rising are one
 * change, and two transactions could leave the second half unwritten. It also
 * has to be *this* transaction because an IndexedDB transaction commits as soon
 * as no request is outstanding on it — awaiting a second one from inside the
 * first is the trap migrations.ts describes.
 */
export async function bump(
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
 * Creation order answers a question nobody asks. What the sidebar is for is
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
  const stored = items.map((item) => ({ ...item, updatedAt: next++ }));
  for (const item of stored) await tx.store.put(item);
  await tx.done;
  for (const item of stored) await fileCollection(item);
  touched();
}

export const putCollection = (item: Collection): Promise<void> => putCollections([item]);

/** The fields of a Sammlung a caller may change without handing in the whole
 *  of it. Never the id — conventions.md §1.1. */
export type CollectionPatch = Partial<Omit<Collection, 'id'>>;

/**
 * Changes the fields named on one Sammlung and leaves the rest alone, inside
 * one transaction.
 *
 * A rename and a voice change used to be `getCollection`, one field set in the
 * caller and `putCollection` — a read and a write in two transactions with an
 * await between them. Two of those a moment apart each read the record before
 * the other had written it, and whichever put landed second put the other's
 * field back the way it had been: the name typed while the voice sheet was
 * closing, or the voice picked while a rename was still on its way out, was
 * simply gone. Nothing failed. settings.ts's patchSettings tells the same
 * story about the settings record, and this is the same fix for the same
 * reason — the merge happens between a `get` and a `put` of one readwrite
 * transaction, and IndexedDB runs overlapping readwrite transactions one at a
 * time in the order they were created, so no patch is ever applied to a
 * snapshot another one has already moved on from.
 * tests/unit/db-atomic-writes.test.ts is what goes red without it.
 *
 * Every await in here is on this transaction's own requests: nextStamp reads
 * the same store through it. That is migrations.ts's rule — a transaction
 * commits the moment control reaches the event loop with nothing pending.
 *
 * The Sammlung moves to the top of §1.4's order, as it does under every other
 * write to it: editing the name or the voice is working on it.
 *
 * A field named with `undefined` is removed rather than stored as an undefined
 * value — patchSettings's rule, so that `{ voice: undefined }` hands a Sammlung
 * back to the default voice.
 *
 * Answers null, and writes nothing, for a Sammlung that is not there: a patch
 * does not make one, and one deleted a moment before does not come back.
 */
export async function patchCollection(
  id: string, patch: CollectionPatch,
): Promise<Collection | null> {
  const tx = (await db()).transaction('collections', 'readwrite');
  const held = await tx.store.get(id);
  if (!held) {
    await tx.done;
    return null;
  }
  const merged: StoredCollection = {
    ...held, ...patch, updatedAt: await nextStamp(tx.store.index('updatedAt')),
  };
  for (const key of Object.keys(patch) as (keyof CollectionPatch)[]) {
    if (patch[key] === undefined) delete (merged as Partial<Collection>)[key];
  }
  await tx.store.put(merged);
  await tx.done;
  await fileCollection(merged);
  touched();
  return declared(merged)!;
}

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
  await unfileCollection(id);
  /* The sentences kept their text and lost a membership, which is a change to
     each of them. §4.3: the Sammlung goes, the sentences stay. */
  await mirror('saetze');
  touched();
  return true;
}
