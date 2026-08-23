import { expect, test } from '@playwright/test';

/**
 * Bringing a file in, and what happens to the voice it names.
 *
 * Our own export is a list of sentences with the voice each was recorded in.
 * That voice is the point of the program — every device speaking alike — so it
 * travels with the sentence. It can only travel as far as the receiving browser
 * can speak, though: a shipped voice works anywhere, an Azure voice needs the
 * key that browser may not have. No recording happens here, so what is checked
 * is what was stored and what the page said about it.
 */

const VOICES = [
  { Name: 'Microsoft Server Speech Text to Speech Voice (de-DE, KatjaNeural)',
    ShortName: 'de-DE-KatjaNeural', DisplayName: 'Katja', LocalName: 'Katja',
    Locale: 'de-DE', Gender: 'Female', VoiceType: 'Neural', Status: 'GA' },
];

const VOICE_LIST = /tts\.speech\.microsoft\.com\/cognitiveservices\/voices\/list/;

type Page = import('@playwright/test').Page;

async function openData(page: Page) {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);
  await page.click('#gear');
  await page.click('#p-data > summary');
}

/** The file input is hidden behind a button; Playwright fills it directly. */
async function importJson(page: Page, name: string, data: unknown) {
  await page.setInputFiles('#importfile', {
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
}

/**
 * What was actually kept, rather than what the list found room to show: a
 * sentence with no recording names no voice on screen whatever it carries.
 * Sentence and voice as a pair, so an absent voice is asserted as null rather
 * than as a property that happens to be missing.
 */
async function stored(page: Page): Promise<[string, string | null][]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('mitreden');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const ask = open.result.transaction('meta').objectStore('meta').get('phrases');
      ask.onerror = () => reject(ask.error);
      ask.onsuccess = () => resolve(((ask.result ?? []) as { text: string; voice?: string }[])
        .map((item) => [item.text, item.voice ?? null] as [string, string | null]));
    };
  }));
}

test('a shipped voice travels with the sentence, and is not remarked on', async ({ page }) => {
  await openData(page);
  await importJson(page, 'mitreden-alle-saetze-2026-08-23.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'piper:de_DE-thorsten-medium' },
  ]);
  await expect(page.locator('#s')).toContainText('1 hinzugefügt');
  // Every browser can speak a shipped voice, so nothing was lost and there is
  // nothing to say about it.
  await expect(page.locator('#s')).not.toContainText('Stimme');
  expect(await stored(page)).toEqual([['Ich habe Hunger.', 'piper:de_DE-thorsten-medium']]);
});

test('a voice this browser cannot reach is dropped, and the page says so', async ({ page }) => {
  await openData(page);
  await importJson(page, 'mitreden-alle-saetze-2026-08-23.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'azure:de-DE-KatjaNeural' },
    { id: 'noch-eins', text: 'Noch eins.', collections: [], voice: 'piper:de_DE-thorsten-medium' },
  ]);
  await expect(page.locator('#s')).toContainText('2 hinzugefügt');
  // No key here, so Azure's voice is not one this page has. Saying so is the
  // difference between a picker that looks ignored and one that is explained.
  await expect(page.locator('#s')).toContainText('Bei 1 davon fehlt die Stimme');
  // Dropped rather than kept: build() prefers a sentence's own voice, so an
  // Azure voice left on it here would fail every recording.
  expect(await stored(page)).toEqual([
    ['Ich habe Hunger.', null],
    ['Noch eins.', 'piper:de_DE-thorsten-medium'],
  ]);
});

test('the same file keeps its Azure voice on a browser that has the key', async ({ page }) => {
  await page.route(VOICE_LIST, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) }));
  await openData(page);
  await page.click('#p-azure > summary');
  await page.fill('#azurekey', '0'.repeat(32));
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });

  await importJson(page, 'mitreden-alle-saetze-2026-08-23.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'azure:de-DE-KatjaNeural' },
  ]);
  await expect(page.locator('#s')).toContainText('1 hinzugefügt');
  await expect(page.locator('#s')).not.toContainText('fehlt die Stimme');
  expect(await stored(page)).toEqual([['Ich habe Hunger.', 'azure:de-DE-KatjaNeural']]);
});

test('a bildhaft archive names no voice, so none is missing', async ({ page }) => {
  await openData(page);
  await importJson(page, 'bildhaft-gruffelo.json', {
    format: 'bildhaft.collection', version: 1, exportedAt: '2026-08-23T10:00:00.000Z',
    collection: { id: 'c1', name: 'Der Grüffelo', sentenceIds: ['s1'], createdAt: 0, updatedAt: 0 },
    sentences: [{
      id: 's1', normalizedInput: 'ich bin die maus', rawInput: 'Ich bin die Maus.',
      slots: [], collectionId: 'c1', createdAt: 0, updatedAt: 0,
    }],
    notice: '',
  });
  await expect(page.locator('#s')).toContainText('1 hinzugefügt');
  // bildhaft draws pictograms and has no voices at all. A file that never
  // named one has lost nothing, and the sentence about it must stay away.
  await expect(page.locator('#s')).not.toContainText('fehlt die Stimme');
  expect(await stored(page)).toEqual([['Ich bin die Maus.', null]]);
});

test('a sentence already here keeps the voice it has', async ({ page }) => {
  await openData(page);
  await importJson(page, 'erste.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'piper:de_DE-thorsten-medium' },
  ]);
  await expect(page.locator('#s')).toContainText('1 hinzugefügt');
  // The twin may already have the recording; the file's voice is about a copy
  // of the sentence that did not survive the merge.
  await importJson(page, 'zweite.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'azure:de-DE-KatjaNeural' },
  ]);
  await expect(page.locator('#s')).toContainText('1 gab es schon');
  await expect(page.locator('#s')).not.toContainText('fehlt die Stimme');
  expect(await stored(page)).toEqual([['Ich habe Hunger.', 'piper:de_DE-thorsten-medium']]);
});
