import { expect, test } from '@playwright/test';

/**
 * The phone. Only what is genuinely different there: the sidebar is a drawer
 * behind a scrim, and the workhead stacks instead of squeezing three controls
 * onto one line. Everything else is the desktop suite's job.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('the sidebar is a drawer: opens over a scrim, closes by tapping it', async ({ page }) => {
  const rail = page.locator('#rail');
  await expect(rail).not.toBeInViewport();
  await page.click('#railopen');
  await expect(rail).toBeInViewport();
  await expect(page.locator('#scrim')).toBeVisible();
  await page.locator('#scrim').click({ position: { x: 350, y: 400 } });
  await expect(rail).not.toBeInViewport();
});

test('opening a Sammlung closes the drawer', async ({ page }) => {
  await page.click('#railopen');
  await page.click('#rows .collections__item');
  await expect(page.locator('#rail')).not.toBeInViewport();
});

test('nothing overflows the screen', async ({ page }) => {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBe(0);
});

test('a rail put away on a laptop still opens as a drawer here', async ({ page }) => {
  // The choice is remembered, and it is a desktop choice: there is no control
  // on this width to undo it, so it must not follow the user onto the phone.
  //
  // Put away through the control, at the width the control exists at, rather
  // than by seeding the store. This used to write localStorage directly, and
  // when the preference moved into the settings record (§1.3) that line stopped
  // reaching anything — the test would have stayed green while asserting
  // nothing, because on a phone the rail is off-canvas either way.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('#railhide');
  await expect(page.locator('#railshow')).toBeVisible();

  // The write is asynchronous, so the reload has to come after it lands rather
  // than after the class changes. Asked of the database, which is the thing
  // being relied on.
  await page.waitForFunction(() => new Promise<boolean>((keep) => {
    const request = indexedDB.open('mitreden');
    request.onerror = () => keep(false);
    request.onsuccess = () => {
      const database = request.result;
      const ask = database.transaction('settings').objectStore('settings').get('settings');
      ask.onsuccess = () => {
        database.close();
        keep((ask.result as { railOpen?: boolean } | undefined)?.railOpen === false);
      };
      ask.onerror = () => { database.close(); keep(false); };
    };
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
  const rail = page.locator('#rail');
  await expect(rail).not.toBeInViewport();
  await page.click('#railopen');
  await expect(rail).toBeInViewport();
});
