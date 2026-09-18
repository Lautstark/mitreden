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

/** The fields of a sentence a caller may change without handing in the whole
 *  of it. Never the id: it is a file name on somebody's talker. */
export type PhrasePatch = Partial<Omit<Phrase, 'id'>>;

/**
 * Changes the fields named on the sentences named, leaves the rest of each
 * alone, and writes all of them or none — inside one transaction.
 *
 * Two writers used to reach a sentence with a copy read a moment earlier.
 * editPhrase read it, changed the text and put it back; build() put back the
 * copy it had read at the *start* of the run, with the voice and the
 * fingerprint filled in — a copy that could be minutes old by the time the
 * recording landed. Either one landing beside another write to the same row put
 * that write back the way it was: the text just corrected, or the membership a
 * deleted Sammlung had just taken with it. Nothing failed.
 *
 * So a writer that means "these two fields" says these two fields, and the
 * merge happens between the `get` and the `put` of one readwrite transaction —
 * which IndexedDB runs one at a time against every other transaction over the
 * same stores, in the order they were created. A row can no longer be put back
 * from a snapshot something else has moved on from. patchSettings in
 * settings.ts and patchCollection in collections.ts are the same rule for the
 * other two records, and tests/unit/db-atomic-writes.test.ts holds all three.
 *
 * Everything putPhrases stamps is stamped here too, for the reasons written
 * there: `norm` follows the text, `updatedAt` is what the folder compares, and
 * the Sammlungen the sentences are in — and the one a sentence just left, as
 * under dropPhrase — rise to the top of §1.4's order in the same transaction.
 *
 * A sentence that is not there is skipped rather than made: a patch to a row
 * deleted a moment before must not bring it back, which is the other thing a
 * put of an old copy did. A field named with `undefined` is removed, the rule
 * the other two patch writers have. Announces once for the batch, and not at
 * all when nothing was found to write.
 */
export async function patchPhrases(patches: ReadonlyMap<string, PhrasePatch>): Promise<Phrase[]> {
  if (!patches.size) return [];
  const tx = (await db()).transaction(['phrases', 'collections'], 'readwrite');
  const phrases = tx.objectStore('phrases');
  const at = Date.now();
  const stored: (StoredPhrase & { updatedAt: number })[] = [];
  const moved: (string | undefined)[] = [];
  for (const [id, patch] of patches) {
    const held = await phrases.get(id);
    if (!held) continue;
    const merged = { ...held, ...patch };
    for (const key of Object.keys(patch) as (keyof PhrasePatch)[]) {
      if (patch[key] === undefined) delete (merged as Partial<Phrase>)[key];
    }
    const item = { ...merged, norm: normText(merged.text), updatedAt: at };
    await phrases.put(item);
    stored.push(item);
    moved.push(held.collection, item.collection);
  }
  if (!stored.length) {
    await tx.done;
    return [];
  }
  await bump(tx, moved);
  await tx.done;
  for (const item of stored) await filePhrase(item);
  await mirror('sammlungen');
  touched();
  return stored.map((item) => shown(item)!);
}

/** One sentence, some of its fields. Null when it is not there. */
export async function patchPhrase(id: string, patch: PhrasePatch): Promise<Phrase | null> {
  const [one] = await patchPhrases(new Map([[id, patch]]));
  return one ?? null;
}

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
