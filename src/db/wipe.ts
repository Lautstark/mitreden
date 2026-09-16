import { isStale, isStore } from './folder.ts';
import { db, touched } from './db.ts';
import { mirror } from './mirror.ts';
import { SETTINGS } from './schema.ts';

/**
 * Everything, gone: every store, for the settings dialog's last button.
 *
 * **And the folder with it.** This cleared the browser and stopped, which every
 * other mutation in db/ does not — `putPhrase`, `putCollection` and the rest
 * all mirror afterwards. Where a folder is the store that omission made this
 * the one control that reports success and changes nothing durable: the files
 * stayed, `wipeEverything()` reloads the page, `pullFromFolder()` reads the
 * folder back, and the recordings return with it because they are keyed by the
 * sentence id that came back unchanged. Somebody watched their library
 * reappear.
 *
 * `mirror` reads the stores and pushes what it finds, so calling it *after* the
 * clear pushes nothing and `pushKind` removes every file that is no longer
 * matched. Same shape as everywhere else in db/, which is the point — this was
 * never a different problem, it was a missing line.
 *
 * The caller must not offer this while the folder is out of reach: `canWrite()`
 * is false then and the folder would keep everything while the browser emptied.
 * See `wipeReaches` below, which is what the settings dialog asks first.
 */
export async function wipe(): Promise<void> {
  const database = await db();
  await Promise.all([
    database.clear('phrases'),
    database.clear('collections'),
    database.clear(SETTINGS),
    database.clear('audio'),
  ]);
  await mirror('sammlungen', 'saetze');
  touched();
}

/**
 * Whether a wipe would reach everything it promises.
 *
 * Three answers rather than a boolean, because the sentence the dialog has to
 * say differs in each: with no folder it is this browser; with a reachable
 * folder it is every device the household has; and with a folder that is not
 * answering it is *nothing anybody should start*, because the browser would
 * empty while the folder kept the lot and handed it back on the next start.
 */
export function wipeReaches(): 'browser' | 'folder' | 'unreachable' {
  if (!isStore()) return 'browser';
  return isStale() ? 'unreachable' : 'folder';
}
