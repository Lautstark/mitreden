/* The one settings record. What is in it is schema.ts's Settings. */
import { db, touched } from './db.ts';
import { SETTINGS, type Settings } from './schema.ts';

export type { Settings } from './schema.ts';

export async function loadSettings(): Promise<Settings> {
  return (await (await db()).get(SETTINGS, SETTINGS)) ?? {};
}

/**
 * The whole record, replaced. Changing one preference is patchSettings below,
 * and that is now every writer in the program: what is left here is the write
 * for a caller that genuinely has all of it, which today is the tests seeding a
 * record they then assert the shape of. Kept rather than folded into the patch
 * because replacing and merging are different questions — a patch cannot say
 * "and nothing else", and a seed has to be able to.
 */
export async function saveSettings(value: Settings): Promise<void> {
  await (await db()).put(SETTINGS, value, SETTINGS);
  touched();
}

/**
 * Changes the fields named and leaves the rest alone, inside one transaction.
 *
 * Every preference here is one row of one record, so each writer used to be a
 * load, a merge in the caller and a put — `saveSettings({ ...await
 * loadSettings(), voice })` and four more of the same shape in repo.ts. That is
 * a read-modify-write across *two* transactions with an await between them, and
 * two of them in flight at once commit in the order their reads resolved rather
 * than the order they were asked for. The value stored is then not the last one
 * asked for, and a reload settles the disagreement the wrong way.
 *
 * It was not theoretical. The Svelte conversion took out the synchronous
 * repaints that had been spacing these writes apart, and the voice picker began
 * losing a press about one run in forty-eight — arrow down, arrow up, reload,
 * and the voice above the chosen one is back. ui/voices.svelte.ts held a chain
 * against it; this is the fix that chain was standing in for, and it covers
 * every preference rather than the one that is pressed three times in a second.
 *
 * The merge happens between a `get` and a `put` of the same readwrite
 * transaction, so no patch can be applied to a snapshot another one has already
 * moved on from: IndexedDB runs readwrite transactions whose scopes overlap one
 * at a time, in the order they were created, and two calls into this function
 * create their transactions in the order they were called — `db()` hands both
 * the same promise, pending or settled, and continuations run in the order they
 * were registered. Asked-for order is therefore stored order.
 *
 * That half is the one the unit tests cannot show — fake-indexeddb resolves
 * those two reads in the order they were asked for, every run, so only a
 * browser and a repeated e2e run ever saw it. What they do show is the worse
 * half, and it is deterministic: two *different* preferences written in the
 * same moment used to lose one of the two outright, each call having read the
 * record before the other wrote it. tests/unit/settings-patch.test.ts says
 * which of its cases pins which.
 *
 * A field named with `undefined` is **removed** rather than stored as an
 * undefined value, which is what makes `patchSettings({ azure })` the whole of
 * saveAzure — setting the key and forgetting it are one call. Every field of
 * Settings is optional, so there is no patch this cannot express.
 */
export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  const tx = (await db()).transaction(SETTINGS, 'readwrite');
  const merged: Settings = { ...(await tx.store.get(SETTINGS)), ...patch };
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    if (patch[key] === undefined) delete merged[key];
  }
  await tx.store.put(merged, SETTINGS);
  await tx.done;
  // Once per write, like every other writer in db/: the standing backup counts
  // these, and a merge that touched three fields is still one change.
  touched();
}
