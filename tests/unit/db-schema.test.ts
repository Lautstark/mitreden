import { beforeAll, describe, expect, it } from 'vitest';

/* The database somebody already had, and what the current version does with it:
 * nothing.
 *
 * There is no carrying-across from version 1 and there is not meant to be —
 * conventions.md's rule about its own rules: one user, disposable data, and the
 * old shape deleted in the change that adopts the new one. A library worth
 * keeping across this goes out through the Sicherung, which is what that file is
 * for and is a better answer than a migration nobody reads a second time.
 *
 * Version 3 is the exception, and the reason it is one is in db-migration.test.ts
 * beside the migration it tests: that upgrade carries recordings, which no
 * Sicherung holds.
 *
 * So what is under test is that the drop is *clean*, not that it happens. An
 * upgrade that threw would leave db() rejecting forever, on a page that looks
 * fine until the first write — and only a browser that had been here before
 * would ever see it. Every other test in this suite starts from no database at
 * all and cannot.
 */

const DB_NAME = 'mitreden';

/** Version 1, made the way version 1 made it: one `meta` store holding the
 *  whole library as two JSON arrays under two keys, the settings beside them,
 *  and `audio` as a loose key-value store. Written out here rather than
 *  imported, because the point is to reproduce what is already on somebody's
 *  disk — a helper that moved with the code would test the new shape against
 *  itself. */
function seedVersionOne(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of ['meta', 'audio']) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(['meta', 'audio'], 'readwrite');
      const meta = tx.objectStore('meta');
      meta.put([
        { id: 'hunger', text: 'Ich habe Hunger.', collections: ['kueche'] },
        { id: 'durst', text: 'Ich habe Durst.', collections: ['kueche'] },
      ], 'phrases');
      meta.put([{ key: 'kueche', name: 'Küche' }], 'collections');
      meta.put({ voice: 'piper:de_DE-thorsten-medium' }, 'settings');
      // A recording, in a store whose shape did not change, so that "every
      // store is dropped" is a claim with something behind it.
      tx.objectStore('audio').put(new Blob([new Uint8Array([1, 2, 3])]), 'hunger');
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/* Imported after the old database exists, not before: db.ts opens lazily, but a
 * top-level import that ever grew an eager open would make this file quietly
 * test nothing. Loading it here is what guarantees the order. */
let store: typeof import('../../src/db/db.ts');

beforeAll(async () => {
  await seedVersionOne();
  store = await import('../../src/db/db.ts');
});

describe('opening a database left behind by version 1', () => {
  /* The upgrade deletes every store it finds and creates the schema. Both
   * halves can throw — deleteObjectStore outside a versionchange transaction,
   * createIndex on a name already there — and a throw in there rejects the
   * open, which every call in this file is waiting on. */
  it('upgrades without throwing, so the store answers at all', async () => {
    await expect(store.allCollections()).resolves.toBeTruthy();
  });

  it('hands back an empty library rather than the one that was there', async () => {
    expect(await store.allPhrases()).toEqual([]);
    expect(await store.allCollections()).toEqual([]);
    expect(await store.countPhrases()).toBe(0);
  });

  /* audio/ has the same shape in both versions and is dropped anyway. Keeping
   * it would leave a browser holding recordings for sentences that no longer
   * exist — half-old, which is the state this change exists to not leave. */
  it('drops the recordings too, rather than keeping them half-old', async () => {
    expect(await store.getAudio('hunger')).toBeUndefined();
  });

  it('drops the settings, which nothing else carried', async () => {
    expect(await store.loadSettings()).toEqual({});
  });

  /* And it is an ordinary database afterwards, indexes and all. */
  it('takes a write afterwards, the way a browser that had never been here does', async () => {
    await store.putCollection({ id: 'neu', name: 'Neu' });
    await store.putPhrases([{ id: 'a', text: 'Hallo.', collection: 'neu' }]);

    expect((await store.allCollections()).map((c) => c.id)).toEqual(['neu']);
    expect(await store.countIn('neu'), 'the membership index was created too').toBe(1);
    expect((await store.twinsOf('hallo.'))[0]?.id, 'and so was the twin index').toBe('a');
  });
});
