/* --------------------------------------------------------------- phrases --- */
import { normText } from '../core/ids.ts';
import type { Phrase } from '../core/types.ts';
import { filePhrase, unfilePhrase } from './folder.ts';
import { bump } from './collections.ts';
import { db, touched } from './db.ts';
import { mirror } from './mirror.ts';
import type { StoredPhrase } from './schema.ts';

/** The program's shape, without the index key schema.ts added. */
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
 * `norm` is stamped here and nowhere else — see the head of schema.ts.
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
  /* Stamped here rather than by the caller: the folder decides what to rewrite
     by comparing it, and a record that never changes its stamp is a record the
     folder stops believing has changed. conventions.md §1.4. */
  const at = Date.now();
  const stored = items.map((item) => ({ ...item, norm: normText(item.text), updatedAt: at }));
  for (const item of stored) await phrases.put(item);
  await bump(tx, items.map((item) => item.collection));
  await tx.done;
  for (const item of stored) await filePhrase(item);
  /* Membership moved, so the Sammlungen's own stamps moved with it. */
  await mirror('sammlungen');
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
  await unfilePhrase(id);
  if (held?.collection) await mirror('sammlungen');
  touched();
}
