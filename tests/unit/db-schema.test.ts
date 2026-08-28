import { beforeAll, describe, expect, it } from 'vitest';

/* The database somebody already had, and what the current version does with it:
 * nothing at all, until somebody says otherwise.
 *
 * This file used to assert the opposite, and the change is worth recording
 * rather than quietly rewriting. The rule was conventions.md's rule about its
 * own rules — one user, disposable data, and the old shape deleted in the
 * change that adopts the new one — with a Sicherung as the way to carry a
 * library across. Under it, a version 1 database was dropped cleanly and the
 * page opened empty and working.
 *
 * "One user" is not one browser once this is served from a domain. Versions 1
 * and 2 were live between 2026-08-22 and 2026-08-25, so a browser still
 * holding one is one that has not been back since — the browser least likely
 * to have a Sicherung and least likely to be watched while it loses its
 * library. The drop was clean, which was the old claim under test, and that is
 * exactly what made it invisible.
 *
 * So the claim now is that the records are still there afterwards, and that
 * the discard still exists but has to be asked for. db-refusal.test.ts makes
 * the same case from version 2, which is the other shape that shipped; the
 * carrying-across from version 3 is in db-migration.test.ts.
 */

const DB_NAME = 'mitreden';

/** Version 1, made the way version 1 made it: one `meta` store holding the
 *  whole library as two arrays, and an `audio` store beside it. */
function seedVersionOne(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('meta');
      database.createObjectStore('audio');
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
      // A recording, in a store whose shape did not change, so that "nothing
      // was touched" is a claim with something behind it.
      tx.objectStore('audio').put(new Blob([new Uint8Array([1, 2, 3])]), 'hunger');
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** Opens whatever is on disk without upgrading it, so the test can look at a
 *  database this version has refused to touch. */
function openAsIs(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

const get = <T>(store: string, key: string, database: IDBDatabase): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T);
  });

/* Imported after the old database exists, not before: db.ts opens lazily, but a
 * top-level import that ever grew an eager open would make this file quietly
 * test nothing. Loading it here is what guarantees the order. */
let store: typeof import('../../src/db/db.ts');

beforeAll(async () => {
  await seedVersionOne();
  store = await import('../../src/db/db.ts');
});

describe('opening a database left behind by version 1', () => {
  it('refuses, rather than opening onto an empty library', async () => {
    await expect(store.db()).rejects.toSatisfy(store.isRefusal);
  });

  /* The whole point, and the half that used to be false. `meta` is a store no
   * current version has ever heard of, which is the strongest form of the
   * claim: the upgrade did not get far enough to have an opinion about it. */
  it('leaves the library and the recording exactly where they were', async () => {
    const database = await openAsIs();
    try {
      expect(database.version, 'the version was not moved').toBe(1);
      expect(await get<unknown[]>('meta', 'phrases', database)).toHaveLength(2);
      expect(await get<unknown[]>('meta', 'collections', database)).toHaveLength(1);
      expect(await get('meta', 'settings', database)).toBeTruthy();
      expect(await get('audio', 'hunger', database), 'the recording too').toBeTruthy();
    } finally {
      database.close();
    }
  });

  it('refuses again on a second open, rather than caching a broken handle', async () => {
    await expect(store.db()).rejects.toSatisfy(store.isRefusal);
  });

  /* The old behaviour is still reachable — it is what somebody who has been
   * told what is there and wants to start again gets. What changed is that it
   * is now a decision rather than the price of visiting the page. */
  it('hands back an empty library once the old one is discarded on purpose', async () => {
    await store.discardEverything();
    expect(await store.allPhrases()).toEqual([]);
    expect(await store.allCollections()).toEqual([]);
    expect(await store.countPhrases()).toBe(0);
    expect(await store.getAudio('hunger')).toBeUndefined();
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
