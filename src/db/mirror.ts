/* The folder as the store: what is mirrored into it after a write, and what is
   read back out of it on start. folder.ts is the folder itself; this is the
   database's side of the arrangement. */
import { normText } from '../core/ids.ts';
import {
  adopt, adopted, asPhrase, asStored, isStore, pushKind, readKind, type Kind,
} from './folder.ts';
import { db, touched } from './db.ts';
import type { StoredCollection } from './schema.ts';

/* Where a folder is the store, a change made inside one transaction is mirrored
   afterwards, wholesale: a folder write cannot happen inside a transaction that
   has to stay open. */
export async function mirror(...kinds: Kind[]): Promise<void> {
  if (!isStore()) return;
  const database = await db();
  for (const kind of kinds) {
    if (kind === 'sammlungen') await pushKind('sammlungen', await database.getAll('collections'));
    if (kind === 'saetze') {
      const rows = await database.getAll('phrases');
      await pushKind('saetze', await Promise.all(rows.map(asStored)));
    }
  }
}

/* The folder is the truth where one is connected: on start it is read and the
   browser's copy is replaced wholesale. Only a folder that has finished becoming
   the store — one halfway through adoption holds fewer records than the browser
   does, and reading that back is indistinguishable from "everything was deleted
   elsewhere". It is not the same thing, and guessing cost a household its
   calendar once. */
export async function pullFromFolder(): Promise<boolean> {
  if (!isStore() || !(await adopted())) return false;
  const database = await db();
  const [saetze, sammlungen] = await Promise.all([
    readKind<Record<string, unknown>>('saetze'),
    readKind<StoredCollection>('sammlungen'),
  ]);
  const tx = database.transaction(['phrases', 'collections'], 'readwrite');
  await tx.objectStore('phrases').clear();
  await tx.objectStore('collections').clear();
  for (const row of saetze) {
    const item = asPhrase(row);
    await tx.objectStore('phrases').put({ ...item, norm: normText(item.text) });
  }
  for (const item of sammlungen) await tx.objectStore('collections').put(item);
  await tx.done;
  /* The audio stays. It is keyed by the sentence's own id, which came back
     unchanged, and what no longer matches its text is already answered by
     `fingerprint`. */
  touched();
  return true;
}

/* Connecting a folder for the first time is the migration with a before and an
   after. A folder that is already a store replaces what this browser holds; one
   that is not adopts what this browser holds — written, checked, and only then
   marked. */
export async function adoptFolder(): Promise<'pushed' | 'pulled' | 'incomplete'> {
  if (await adopted()) { await pullFromFolder(); return 'pulled'; }
  const database = await db();
  const rows = await database.getAll('phrases');
  const went = await adopt({
    saetze: await Promise.all(rows.map(asStored)),
    sammlungen: await database.getAll('collections'),
  });
  if (!went.adopted) return went.reason === 'already' ? 'pulled' : 'incomplete';
  return 'pushed';
}
