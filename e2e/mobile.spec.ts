import { expect, test } from '@playwright/test';

/**
 * The phone. Only what is genuinely different there: the sidebar is a drawer
 * behind a scrim, and the workhead stacks instead of squeezing three controls
 * onto one line. Everything else is the desktop suite's job.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);
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
  await page.click('#rows .list__item');
  await expect(page.locator('#rail')).not.toBeInViewport();
});

test('nothing overflows the screen', async ({ page }) => {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBe(0);
});
