import { expect, test } from '@playwright/test';

/** Nothing in the console. A page that cries wolf gets read as noise. */
test('the page loads and is used without saying anything to the console', async ({ page }) => {
  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') noise.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => noise.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => noise.push(`failed: ${request.url()}`));

  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);
  await page.fill('#t', 'Eine Zeile.');
  await page.click('#gear');
  for (const tab of ['voices', 'language', 'data']) await page.click(`#tabs .tab[data-tab="${tab}"]`);
  await page.click('#setupclose');
  await page.click('#newcol');
  await page.waitForTimeout(300);

  expect(noise).toEqual([]);
});
