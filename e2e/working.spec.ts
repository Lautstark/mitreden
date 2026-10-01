import { expect, test } from '@playwright/test';

/*
 * That the page says when it is working.
 *
 * A sentence is saved before it is recorded — deliberately, so the list fills
 * up instead of staying empty through a 60 MB model download. But the row
 * arrived reading "noch nicht aufgenommen", which is true and is also what a
 * sentence nobody has done anything about says, so the one moment the page is
 * busiest looked exactly like the one where it is idle. The status line had
 * the same problem one line up: "Wird aufgenommen …" was set in the same grey
 * as "3 hinzugefügt" and then just sat there.
 *
 * Both are checked here rather than in audio.spec.ts, which is about the file
 * that comes out. This is about the minute before it does.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=en');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('a sentence being recorded says so, and does not say it is untouched', async ({ page }) => {
  await page.fill('#t', 'I want to join in.\nLeave me alone.');
  await page.click('#add');

  // No waiting for audio: this is the state the rows are in while the voice is
  // still being fetched, and it has to be readable from the first moment.
  await expect(page.locator('#list .item.busy')).toHaveCount(2);
  await expect(page.locator('#list .item.recording')).toHaveCount(1);
  await expect(page.locator('#list .item.recording .state')).toHaveText('recording now …');
  await expect(page.locator('#list .item.queued .state')).toHaveText('waiting to be recorded');
  await expect(page.locator('#list .item.busy .st').first()).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#list .item .state', { hasText: 'not recorded yet' })).toHaveCount(0);

  // The line one row up is marked as a job under way, and the words are still
  // only the words — the marker is drawn, so a reader hears the sentence.
  const line = page.locator('#s');
  await expect(line).toHaveClass(/working/);
  expect(await line.evaluate((node) =>
    getComputedStyle(node, '::before').width)).not.toBe('auto');
});

test('a finished sentence stops waiting while the rest of the batch runs', async ({ page }) => {
  test.slow();
  test.setTimeout(5 * 60_000);

  await page.fill('#t', 'One more time.\nNot now.');
  await page.click('#add');

  // The first one is done long before the second is, and it says so then —
  // not at the end of the batch. That was the other half of the same defect:
  // a sentence with its recording already stored still read as untouched.
  await expect(page.locator('#list .item.ok audio')).toHaveCount(1, { timeout: 4 * 60_000 });

  await expect(page.locator('#list .item.ok')).toHaveCount(2, { timeout: 60_000 });
  // Nothing is left claiming to be busy once the batch is over — a marker that
  // outlives its job is worse than none.
  await expect(page.locator('#list .item.busy')).toHaveCount(0);
  await expect(page.locator('#s')).not.toHaveClass(/working/);
  await expect(page.locator('#count')).toContainText('all recorded');
});

/*
 * And that it stops saying so when the job ends badly.
 *
 * The busy line is only ever taken away by the next thing the page says, so a
 * way out that says nothing leaves it turning for the rest of the session.
 * Adding had one — any error from the write escaped `void add()` as an
 * unhandled rejection, with the rows still queued — and correcting a sentence
 * had another: one deleted while it was being typed in came back from the
 * write as nothing, and the edit returned quietly with the page still busy.
 */
test('a write that fails says so, and the page stops claiming to be busy', async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
  // The store refuses every sentence, the way a full disk does.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'phrases') throw new DOMException('Kein Platz mehr.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });

  await page.fill('#t', 'Ich habe Hunger.');
  await page.click('#add');

  await expect(page.locator('#s')).toContainText('Kein Platz mehr.');
  await expect(page.locator('#s')).not.toHaveClass(/working/);
  // Nothing was written, so nothing typed was thrown away.
  await expect(page.locator('#t')).toHaveValue('Ich habe Hunger.');
});

test('correcting a sentence that was deleted meanwhile says so, and stops', async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
  /* Written straight into the store rather than typed: a typed sentence starts
     a recording, and its "done" at the end would say something over the line
     this test is reading. */
  const run = (script: string) => page.evaluate((code) => new Promise<void>((done, fail) => {
    const request = indexedDB.open('mitreden');
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(['phrases', 'collections'], 'readwrite');
      // eslint-disable-next-line no-new-func
      new Function('tx', code)(tx);
      tx.oncomplete = () => { database.close(); done(); };
      tx.onerror = () => { database.close(); fail(tx.error); };
    };
  }), script);
  await run(`tx.objectStore('collections').getAll().onsuccess = (event) => {
    const [first] = event.target.result;
    tx.objectStore('phrases').put({
      id: 'ein-satz', text: 'Ein Satz.', norm: 'ein satz.', collection: first.id, updatedAt: Date.now(),
    });
  };`);
  await page.reload();
  await expect(page.locator('.item .line')).toHaveText('Ein Satz.');

  await page.click('.item .line');
  await run(`tx.objectStore('phrases').delete('ein-satz');`);
  await page.keyboard.type('Ein anderer Satz.');
  await page.keyboard.press('Enter');

  await expect(page.locator('#s')).toHaveText('Den Satz gibt es nicht mehr.');
  await expect(page.locator('#s')).not.toHaveClass(/working/);
  await expect(page.locator('.item')).toHaveCount(0);
});
