import { expect, test } from '@playwright/test';

/**
 * The Azure key, without an Azure key.
 *
 * Every answer the endpoint can give is stubbed, because the thing that was
 * broken was never Azure: it was that the page said nothing at all while the
 * check ran, and then said nothing useful when it failed. That is testable
 * without a subscription, and the real request is one call in stimmquelle.
 */

const VOICES = [
  { Name: 'Microsoft Server Speech Text to Speech Voice (de-DE, KatjaNeural)',
    ShortName: 'de-DE-KatjaNeural', DisplayName: 'Katja', LocalName: 'Katja',
    Locale: 'de-DE', Gender: 'Female', VoiceType: 'Neural', Status: 'GA' },
];

async function openVoices(page: import('@playwright/test').Page) {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);
  await page.click('#gear');
  await page.click('#tabs .tab[data-tab="voices"]');
}

test('a key Azure refuses says which of the two things is wrong', async ({ page }) => {
  await page.route('**/cognitiveservices/voices/list', (route) =>
    route.fulfill({ status: 401, body: '' }));
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.fill('#azureregion', 'westeurope');
  await page.click('#cloud .save');
  // The region is the usual culprit and the message has to say so, in German.
  await expect(page.locator('#s')).toContainText('Region', { timeout: 10_000 });
});

test('the button says it is working while it waits', async ({ page }) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/cognitiveservices/voices/list', async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) });
  });
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.click('#cloud .save');
  // This is the bug that read as "nothing happens".
  await expect(page.locator('#cloud .save')).toBeDisabled();
  await expect(page.locator('#cloud .save')).toHaveText(/prüft/i);
  release?.();
});

test('a key Azure accepts is kept, and its voices join the picker', async ({ page }) => {
  await page.route('**/cognitiveservices/voices/list', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) }));
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.fill('#azureregion', 'westeurope');
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });
  await expect(page.locator('#voice option', { hasText: 'Katja' })).toHaveCount(1);
  // And it is still there after a reload, or it was never really saved.
  await page.reload();
  await expect(page.locator('#voice option', { hasText: 'Katja' })).toHaveCount(1);
});
