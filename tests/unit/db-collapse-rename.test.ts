import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A version 4 library meeting version 5: the collapse preference changes its
 * name and keeps its answer.
 *
 * This is the step almost every existing browser actually takes — version 4 is
 * what has been live since 2026-08-25 — and it is the cheapest migration this
 * repository has: one field of one record of one store. It gets a file anyway,
 * for the reason db.ts's header gives about refusals. A step that silently did
 * nothing would leave the sidebar opening itself on the next visit for
 * everybody who had put it away, and the page would look completely correct.
 *
 * The version 4 database is written out here rather than built with db.ts, for
 * db-migration.test.ts's reason: the point is to reproduce what is on
 * somebody's disk, and a helper that moved with the code would test the new
 * shape against itself.
 *
 * `sidebarOpen` is bildhaft's name for this preference, with the same polarity
 * — conventions.md §6.3 and §1.3. The rename followed the element: mitreden's
 * `.rail` was the column, and the column is `@lautstark/design/svelte/Sidebar`
 * now.
 */

const DB_NAME = 'mitreden';
const THORSTEN = 'piper:de_DE-thorsten-medium';

/** Version 4, made the way version 4 made it. The stores and the indexes are
 *  the current ones; the settings record is what differs. */
function seedVersionFour(settings: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      const database = request.result;
      const phrases = database.createObjectStore('phrases', { keyPath: 'id' });
      phrases.createIndex('collection', 'collection');
      phrases.createIndex('norm', 'norm');
      database.createObjectStore('collections', { keyPath: 'id' })
        .createIndex('updatedAt', 'updatedAt');
      database.createObjectStore('settings');
      database.createObjectStore('audio');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(['phrases', 'collections', 'settings'], 'readwrite');
      tx.objectStore('collections').put({ id: 'kueche', name: 'Küche', updatedAt: 1 });
      tx.objectStore('phrases').put({
        id: 'hunger', text: 'Ich habe Hunger.', norm: 'ich habe hunger.',
        collection: 'kueche',
      });
      tx.objectStore('settings').put(settings, 'settings');
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/* Imported after the old database exists, not before — db-migration.test.ts's
   reason: db.ts opens lazily, and a top-level import that ever grew an eager
   open would make this file quietly test nothing. */
let store: typeof import('./store.ts');

beforeAll(async () => {
  // Put away on a laptop, with two other preferences beside it that must not be
  // disturbed by a rewrite of the whole record.
  await seedVersionFour({ voice: THORSTEN, railOpen: false, open: ['kueche'] });
  store = await import('./store.ts');
});

describe('a version 4 library carried into version 5', () => {
  it('upgrades without throwing, so the store answers at all', async () => {
    await expect(store.allCollections()).resolves.toBeTruthy();
  });

  it('keeps the answer, under the new name', async () => {
    // Carried across rather than defaulted: somebody who put the sidebar away
    // last week finds it still away.
    expect((await store.loadSettings()).sidebarOpen).toBe(false);
  });

  it('takes the old name away rather than leaving it beside the new one', async () => {
    /* patchSettings merges, so a key nothing writes any more is a key nothing
       would ever remove. Left in, every existing browser would carry two
       answers to one question for the life of the database. */
    expect(Object.keys(await store.loadSettings())).not.toContain('railOpen');
  });

  it('leaves every other preference exactly as it was', async () => {
    expect(await store.loadSettings())
      .toEqual({ voice: THORSTEN, sidebarOpen: false, open: ['kueche'] });
  });

  it('leaves the library alone, because this step is not about the library', async () => {
    expect(await store.countIn('kueche')).toBe(1);
    expect((await store.allPhrases()).map((one) => one.id)).toEqual(['hunger']);
  });

  /* And it is an ordinary database afterwards. A failed upgrade leaves db()
     rejecting for the life of the page, which looks like an app that loads and
     then does nothing when you type. */
  it('takes a write afterwards', async () => {
    await store.putPhrases([{ id: 'neu', text: 'Noch ein Satz.', collection: 'kueche' }]);
    expect(await store.countIn('kueche')).toBe(2);
  });
});
