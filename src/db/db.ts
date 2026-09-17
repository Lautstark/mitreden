/**
 * The connection: opening the database, carrying an old one across or
 * refusing to, and the one notifier every write goes through.
 *
 * What is kept and in what shape is schema.ts; the step between versions is
 * migrations.ts; the stores themselves are phrases.ts, collections.ts,
 * settings.ts and audio.ts; the folder that can stand in for all of them is
 * mirror.ts; and the last button in the settings dialog is wipe.ts. This file
 * used to hold all of it.
 *
 * ## Migration: a step for every version crossed, or nothing happens
 *
 * Version 4 carries a version 3 library across, recordings and all:
 * migrations.ts copies blobs where it splits a sentence and deletes none.
 * Nothing is re-recorded and nothing is lost. Version 5 renames one
 * preference, and a version 3 library crosses both steps in order — "a step
 * for every version crossed" is the rule rather than a description of the one
 * step there used to be.
 *
 * Every other old version is **refused**, and the upgrade transaction is
 * aborted so the database keeps its version and its records. That is a change
 * of rule, and it is worth saying what it replaced. This file used to drop
 * every store it found for anything older than 3, on conventions.md's rule
 * about its own rules: one user, disposable data, and the old shape deleted in
 * the change that adopts the new one. A library worth keeping went out through
 * the Sicherung.
 *
 * That rule stopped being true when this went to a domain. "One user" is not
 * one browser: versions 1 and 2 were live between 2026-08-22 and 2026-08-25,
 * and a browser still holding one is a browser that has not been back since —
 * which is exactly the browser that would have lost its library on the next
 * visit, silently, to a page that then worked perfectly. bildhaft reached the
 * same place first and wrote it down; its adr/0001 is the argument, and this
 * is mitreden agreeing with it.
 *
 * Version 4 itself already conceded the principle. The reason it carries a v3
 * library rather than asking for it back is that re-recording a library *in a
 * new arrangement* is the thing a person would want to check before agreeing
 * to — and "the audio is reproducible" is cheap to say and expensive to do. A
 * v1 or v2 library is no more disposable than a v3 one; it is only older.
 *
 * What a refusal costs is that the app cannot open until somebody decides. It
 * says so, and offers to start again — the same discard as before, made once,
 * out loud, by the person whose recordings they are. A step can still be
 * written later; the refusal is what keeps the records alive long enough for
 * that to be possible.
 */

import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import { changes } from '@lautstark/werkzeuge/changed';
import { createStores, type MitredenDB } from './schema.ts';
import { migrateV3toV4, migrateV4toV5 } from './migrations.ts';

/* ---------------------------------------------------------------- change --- */

/*
 * Every write that changes what a Sicherung would contain says so here, and
 * the standing backup listens.
 *
 * The alternative was calling schedule() from each place in the interface that
 * edits something, and it is the wrong shape: the next one would be added by
 * somebody who had never heard of the backup, nothing would fail, and the
 * library would quietly stop being saved. That is this feature's entire
 * failure mode, so the notifier sits at the writes instead.
 *
 * putAudio and dropAudio deliberately do NOT announce. Recordings are not in
 * the backup — they are reproducible, and they are three orders of magnitude
 * the size — so a build of two hundred sentences would otherwise rewrite the
 * file two hundred times to say nothing new.
 *
 * The Set behind it is @lautstark/werkzeuge/changed's now; three products had
 * written the same ten lines. What stays here is the rule above, which is the
 * part that is about mitreden — which writes announce and which two do not.
 * tests/unit/db-notifies.test.ts holds every store to it.
 */
const changed = changes();
export const onChanged = changed.onChanged;
/** Said by every write in the store modules beside this one, after the write. */
export const touched = changed.touched;

/* ------------------------------------------------------------------ open --- */

/**
 * Thrown when a database has to cross a version nothing here knows how to
 * carry. A code rather than a sentence: this file has no language, and the
 * caller has the text table. What it means at the call site is *the library is
 * still there and nothing has touched it.*
 */
export const MISSING_STEP = 'db:no-migration';

/** Whether an error is the refusal above, wherever it surfaced. */
export const isRefusal = (error: unknown): boolean =>
  error instanceof Error && error.message === MISSING_STEP;

/**
 * Why the last open refused, put aside where db() can pick it up.
 *
 * A throw does not abort an *async* upgrade callback the way it aborts a
 * synchronous one: the rejection escapes into nothing idb is watching and the
 * transaction commits regardless. So the refusal is an explicit abort(), and
 * the reason has to travel out of band — what openDB rejects with is an
 * AbortError, which says nothing about why.
 */
let refusal: Error | null = null;

let handle: Promise<IDBPDatabase<MitredenDB>> | null = null;

export function db(): Promise<IDBPDatabase<MitredenDB>> {
  refusal = null;
  handle ??= openDB<MitredenDB>('mitreden', 5, {
    async upgrade(database, from, _to, tx) {
      try {
        // A browser that has never been here — and the way back in after
        // discardEverything(), which deletes the database and so arrives as
        // this same case.
        if (from === 0) {
          createStores(database);
          return;
        }

        // A version 3 library is carried across, recordings and all — and then
        // across the step above it, because a library that skipped a version
        // would be at the new number in the old shape. Written out per starting
        // version rather than as a fall-through chain so that a version added
        // later without a step is still *refused* below rather than silently
        // renumbered.
        if (from === 3) {
          await migrateV3toV4(tx);
          await migrateV4toV5(tx);
          return;
        }

        // A version 4 library needs the settings rename alone.
        if (from === 4) {
          await migrateV4toV5(tx);
          return;
        }

        // Every other version, including any added after this one without a
        // step to go with it. Refusing is the whole point: see the head of
        // this file.
        throw new Error(MISSING_STEP);
      } catch (error) {
        refusal = error instanceof Error ? error : new Error(MISSING_STEP);
        // The abort rejects tx.done, and nothing else is listening to it.
        tx.done.catch(() => undefined);
        tx.abort();
      }
    },
  }).catch((error: unknown) => {
    // Let the next call try again rather than caching a rejected promise — the
    // one after a discard has to be able to succeed.
    handle = null;
    throw refusal ?? error;
  });
  return handle;
}

/**
 * Deletes the database outright, for the one case that cannot be answered any
 * other way: a library this version has no step for, whose owner has been told
 * what it is and has asked to start again anyway. Nothing else in the program
 * calls this — wipe() empties the stores of a database that opens.
 */
export async function discardEverything(): Promise<void> {
  handle = null;
  await deleteDB('mitreden');
  touched();
}
