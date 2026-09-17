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
