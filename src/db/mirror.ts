/* The folder as the store: what is mirrored into it after a write, and what is
   read back out of it on start. folder.ts is the folder itself; this is the
   database's side of the arrangement. */
import { carriedName, normText } from '../core/ids.ts';
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

  /* Every arriving sentence through the carry-across, and before the
     transaction opens.

     db/rekey.ts walks the library once on start and marks that it has; this
     replaces every row in the library and can happen at any moment after
     that — a folder connected in Einstellungen, or the watch firing because
     the other machine in the household wrote. So a library whose names were
     written before stimmquelle 2.12.2 arrives here long after the pass that
     knew how to carry them, and the mark says there is nothing to do. The
     recordings stay (see below), which is exactly what makes it visible: the
     audio is current and the row says „geändert seit der Aufnahme".

     Before the transaction because each of these is a digest, and db.ts is
     emphatic about why one may not happen inside an open one. */
  const arriving = await Promise.all(saetze.map(async (row) => {
    const item = asPhrase(row);
    const carried = await carriedName(item.text, item.voice, item.fingerprint);
    return { ...item, ...carried ? { fingerprint: carried } : {}, norm: normText(item.text) };
  }));

  const tx = database.transaction(['phrases', 'collections'], 'readwrite');
  await tx.objectStore('phrases').clear();
  await tx.objectStore('collections').clear();
  for (const item of arriving) {
    await tx.objectStore('phrases').put(item);
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
