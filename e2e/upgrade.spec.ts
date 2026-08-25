import { expect, test } from '@playwright/test';

/**
 * A browser that was here before version 2, meeting version 2.
 *
 * There is no carrying-across and there is not meant to be — conventions.md's
 * rule about its own rules: one user, disposable data, and the old shape
 * deleted in the change that adopts the new one. What has to hold is that the
 * drop is *clean*. An upgrade that throws leaves db() rejecting for the life of
 * the page, and what that looks like from the outside is an application that
 * loads, draws, and then does nothing when you type — no error, no dialog.
 *
 * It is here rather than in the unit suite because the unit suite runs against
 * fake-indexeddb, and the one thing being asserted is that a real browser's
 * IndexedDB accepts this upgrade: deleting every store inside a versionchange
 * transaction and creating four with three indexes. That is exactly the kind of
 * claim a stand-in can agree with while the real thing refuses.
 *
 * tests/unit/db-schema.test.ts is the same shape against the stand-in, and
 * checks what the upgrade leaves behind; this one checks that the page it
 * leaves behind works.
 */

/** Version 1, made the way version 1 made it: the whole library as two JSON
 *  arrays under two keys in a `meta` store. Written out here rather than
 *  imported, because the point is to reproduce what is on somebody's disk. */
const SEED_V1 = `
  new Promise((keep, drop) => {
    const request = indexedDB.open('mitreden', 1);
    request.onupgradeneeded = () => {
      for (const name of ['meta', 'audio']) request.result.createObjectStore(name);
    };
    request.onerror = () => drop(request.error);
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
      tx.objectStore('audio').put(new Blob([new Uint8Array([1, 2, 3])]), 'hunger');
      tx.oncomplete = () => { database.close(); keep(); };
      tx.onerror = () => drop(tx.error);
    };
  })
`;

test('a browser holding the old database gets a working first visit', async ({ page }) => {
  /* The application's own scripts are blocked for this first load, and that is
     not belt and braces: opening the app is what triggers the upgrade, so if
     any of it ran first the database would already be at version 2 and the seed
     below would fail — or, worse, quietly not matter. Every assertion after the
     reload would then still pass, against a browser that had never held the old
     shape at all. Blocking the scripts is what makes this test about something.

     Found by asking, after it passed: the first version raced the app for the
     database and won, which is not the same as not racing it. */
  await page.route('**/*.js', (route) => route.abort());
  await page.goto('/?lang=de');
  await page.evaluate(SEED_V1);

  // The old shape is really there, with the old library in it. Without this the
  // rest of the test is a first visit dressed up as an upgrade.
  expect(await page.evaluate(() => new Promise((keep, drop) => {
    const request = indexedDB.open('mitreden');
    request.onerror = () => drop(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const ask = database.transaction('meta').objectStore('meta').get('phrases');
      ask.onsuccess = () => {
        const version = database.version;
        const stores = [...database.objectStoreNames].sort();
        database.close();
        keep({ version, stores, kept: (ask.result as unknown[]).length });
      };
    };
  })), 'the seed has to have landed before the app ever ran')
    .toEqual({ version: 1, stores: ['audio', 'meta'], kept: 2 });

  await page.unroute('**/*.js');
  await page.reload();

  // The application comes up: there is always somewhere to be (§1.9), so the
  // empty library it now has is seeded with one Sammlung rather than nothing.
  await page.waitForFunction(
    () => document.querySelectorAll('#rows .collections__item').length > 0,
  );
  await expect(page.locator('#rows .collections__item')).toHaveCount(1);
  // Named for the day rather than "Küche": nothing came across.
  await expect(page.locator('#rows .collections__name')).not.toHaveText('Küche');
  await expect(page.locator('.item')).toHaveCount(0);

  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  // And it takes a write, which is the half a failed upgrade would swallow: the
  // page would look exactly like this and then do nothing at all.
  await page.fill('#t', 'Ich möchte nach draußen.');
  await page.press('#t', 'Enter');
  await expect(page.locator('.item')).toHaveCount(1);

  // It survives a reload, so the sentence reached the store rather than the
  // screen. This is the assertion a rejected db() promise fails.
  await page.reload();
  await expect(page.locator('.item')).toHaveCount(1);
  await expect(page.locator('.item .line')).toHaveText('Ich möchte nach draußen.');

  expect(errors, 'a rejected open shows up here first').toEqual([]);

  // The database is at the new shape, with the indexes the stores are for.
  expect(await page.evaluate(() => new Promise((keep, drop) => {
    const request = indexedDB.open('mitreden');
    request.onerror = () => drop(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const stores = [...database.objectStoreNames].sort();
      const indexes = [...database.transaction('phrases').objectStore('phrases').indexNames].sort();
      database.close();
      keep({ version: database.version, stores, indexes });
    };
  }))).toEqual({
    version: 2,
    stores: ['audio', 'collections', 'phrases', 'settings'],
    indexes: ['collections', 'norm'],
  });
});
