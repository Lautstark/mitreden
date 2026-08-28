import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A version 2 library meeting version 4, and the one thing it must not do.
 *
 * This file used to drop every store it found for anything older than version
 * 3, and the page then opened, empty and working. That is the failure being
 * tested against: not an error somebody sees, but a library that is gone while
 * everything looks fine — and the browser it happens to is by definition one
 * that has not been here since versions 1 and 2 were live, so nobody is
 * watching for it.
 *
 * The claim is therefore about what is *still on disk* after the refusal, not
 * about the error. The seed is version 2 as version 2 actually wrote it — four
 * stores, with `collections` keyed on `key` rather than `id`, which is the
 * change version 3 made — so this reproduces a real disk rather than a shape
 * invented here.
 */

const DB_NAME = 'mitreden';

const bytes = (n: number): Blob => new Blob([new Uint8Array([n, n, n])]);

/** Version 2, made the way version 2 made it. */
function seedVersionTwo(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      const phrases = database.createObjectStore('phrases', { keyPath: 'id' });
      phrases.createIndex('collections', 'collections', { multiEntry: true });
      phrases.createIndex('norm', 'norm');
      database.createObjectStore('collections', { keyPath: 'key' })
        .createIndex('updatedAt', 'updatedAt');
      database.createObjectStore('settings');
      database.createObjectStore('audio');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(
        ['phrases', 'collections', 'settings', 'audio'], 'readwrite',
      );
      tx.objectStore('phrases').put({
        id: 'hunger', text: 'Ich habe Hunger.', norm: 'ich habe hunger.',
        collections: ['kueche'], voice: 'piper:de_DE-thorsten-medium',
      });
      tx.objectStore('collections').put({ key: 'kueche', name: 'Küche', updatedAt: 1 });
      tx.objectStore('audio').put(bytes(1), 'hunger');
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

const only = <T>(store: string, database: IDBDatabase): Promise<T[]> =>
  new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T[]);
  });

let store: typeof import('../../src/db/db.ts');

beforeAll(async () => {
  await seedVersionTwo();
  store = await import('../../src/db/db.ts');
});

describe('a version 2 library meeting version 4', () => {
  it('refuses, rather than opening onto an empty library', async () => {
    await expect(store.db()).rejects.toSatisfy(store.isRefusal);
  });

  /* The whole point, and the half that used to be false. */
  it('leaves the sentence, the Sammlung and the recording where they are', async () => {
    const database = await openAsIs();
    try {
      expect(database.version, 'the version was not moved').toBe(2);
      expect(await only('phrases', database)).toHaveLength(1);
      expect(await only('collections', database)).toHaveLength(1);
      expect(await only('audio', database), 'the recording too').toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('refuses again on a second open, rather than caching a broken handle', async () => {
    await expect(store.db()).rejects.toSatisfy(store.isRefusal);
  });

  /* Declining is not the only way out: somebody who has been told what is
     there can still choose to start again, which is what the old behaviour did
     without asking. After that the app opens normally. */
  it('opens fresh once the library is discarded on purpose', async () => {
    await store.discardEverything();
    await expect(store.allPhrases()).resolves.toEqual([]);
    await expect(store.allCollections()).resolves.toEqual([]);
  });
});
