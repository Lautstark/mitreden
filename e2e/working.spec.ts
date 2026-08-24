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
