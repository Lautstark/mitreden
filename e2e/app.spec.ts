import { expect, test } from '@playwright/test';

/**
 * The page as somebody uses it. No recording happens here — that needs a 60 MB
 * model — so these cover everything up to and around it: the sentence is kept,
 * the Sammlung can be made, named and thrown away, and the dialog opens.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);
});

test('opens with one Sammlung and nothing in it', async ({ page }) => {
  await expect(page.locator('#rows .list__item')).toHaveCount(1);
  await expect(page.locator('.empty')).toContainText('Tippe oben einen Satz');
  await expect(page.locator('.empty kbd')).toHaveText('Enter');
});

test('a sentence typed in is a sentence listed, and survives a reload', async ({ page }) => {
  await page.fill('#t', 'Ich will noch nicht ins Bett.');
  await page.click('#add');
  await expect(page.locator('.item .line')).toHaveText('Ich will noch nicht ins Bett.');
  await page.reload();
  await expect(page.locator('.item .line')).toHaveText('Ich will noch nicht ins Bett.');
});

test('a Sammlung is made, named and deleted through the page', async ({ page }) => {
  await page.click('#newcol');
  await expect(page.locator('#rows .list__item')).toHaveCount(2);
  // Named after the day and already focused, so typing replaces it.
  await expect(page.locator('#colname')).toBeFocused();

  await page.fill('#colname', 'Beim Essen');
  await expect(page.locator('#rows .list__name', { hasText: 'Beim Essen' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#rows .list__name', { hasText: 'Beim Essen' })).toBeVisible();

  await page.click('#rows .list__item:has-text("Beim Essen")');
  page.once('dialog', (d) => void d.accept());
  await page.click('#colmore');
  await page.click('.menu button.danger');
  await expect(page.locator('#rows .list__name', { hasText: 'Beim Essen' })).toHaveCount(0);
});

test('the settings dialog opens on every tab', async ({ page }) => {
  await page.click('#gear');
  await expect(page.locator('#setup')).toBeVisible();
  for (const [tab, marker] of [['voices', '#azurekey'], ['language', '#lang'], ['data', '#export']] as const) {
    await page.click(`#tabs .tab[data-tab="${tab}"]`);
    await expect(page.locator(marker)).toBeVisible();
  }
  // The one the compiler could not check: a sentence saying what the picker does.
  await page.click('#tabs .tab[data-tab="language"]');
  await expect(page.locator('[data-i18n="language_hint"]')).not.toBeEmpty();
});

test('the footer answers what this is, and the two German legal questions', async ({ page }) => {
  await page.click('#about');
  await expect(page.locator('#infotitle')).toHaveText('Was ist mitreden?');
  // The claim and its one exception, together — the rule the old footer broke.
  await expect(page.locator('#infobody')).toContainText('Hugging Face');
  await page.click('#infoclose');
  for (const [id, title] of [['impressum', 'Impressum'], ['datenschutz', 'Datenschutz']] as const) {
    await page.click(`#${id}`);
    await expect(page.locator('#infotitle')).toHaveText(title);
    await page.click('#infoclose');
  }
});

test('the page reaches no host but Hugging Face', async ({ page }) => {
  const offsite: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') offsite.push(url.hostname);
  });
  await page.reload();
  await page.fill('#t', 'Eine Zeile.');
  await page.waitForTimeout(500);
  expect([...new Set(offsite)].filter((h) => h !== 'huggingface.co')).toEqual([]);
});
