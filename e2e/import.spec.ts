import { expect, test } from '@playwright/test';

/**
 * Bringing a file in, and what happens to the voice it names.
 *
 * Our own export is a list of sentences with the voice each was recorded in.
 * That voice is the point of the program — every device speaking alike — so it
 * has to survive the trip. Where it lands has moved: the voice belongs to the
 * Sammlung now, so a file's voice reaches the **Sammlung the import makes**
 * rather than each sentence. A sentence's own voice is written by the recording
 * and by nothing else, and nothing is recorded here.
 *
 * It can only travel as far as the receiving browser can speak, though: a
 * shipped voice works anywhere, an Azure voice needs the key that browser may
 * not have. So what is checked is what was stored and what the page said.
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
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
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
 * What was actually kept, rather than what the list found room to show.
 * Sentence and voice as a pair, so an absent voice is asserted as null rather
 * than as a property that happens to be missing — and here it is absent on
 * purpose: an arriving voice is evidence about the Sammlung, not an instruction
 * about the line, and no recording has happened to write one.
 */
async function stored(page: Page): Promise<[string, string | null][]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    // No version: the page has already opened this database and knows which
    // one it is at. The sentences are a store of their own now, one record
    // each, rather than a JSON array under a key in `meta`.
    const open = indexedDB.open('mitreden');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const ask = open.result.transaction('phrases').objectStore('phrases').getAll();
      ask.onerror = () => reject(ask.error);
      ask.onsuccess = () => resolve((ask.result as { text: string; voice?: string }[])
        .map((item) => [item.text, item.voice ?? null] as [string, string | null]));
    };
  }));
}

/** Which voice each Sammlung records in — where a file's voice now lands. */
async function voices(page: Page): Promise<[string, string | null][]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('mitreden');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const ask = open.result.transaction('collections').objectStore('collections').getAll();
      ask.onerror = () => reject(ask.error);
      ask.onsuccess = () => resolve((ask.result as { name: string; voice?: string }[])
        .map((one) => [one.name, one.voice ?? null] as [string, string | null]));
    };
  }));
}

test('a shipped voice travels with the file, onto the Sammlung it makes', async ({ page }) => {
  await openData(page);
  await importJson(page, 'mitreden-alle-saetze-2026-08-23.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'piper:de_DE-thorsten-medium' },
  ]);
  await expect(page.locator('#s')).toContainText('1 hinzugefügt');
  // Every browser can speak a shipped voice, so nothing was lost and there is
  // nothing to say about it.
  await expect(page.locator('#s')).not.toContainText('Stimme');
  expect(await voices(page), 'the arriving Sammlung records in the file’s voice')
    .toContainEqual(['mitreden-alle-saetze-2026-08-23', 'piper:de_DE-thorsten-medium']);
  // Not on the sentence: that field is written by the recording, which has not
  // happened. The Sammlung is what says how it will sound.
  expect(await stored(page)).toEqual([['Ich habe Hunger.', null]]);
});

test('a voice this browser cannot reach does not win the Sammlung', async ({ page }) => {
  await openData(page);
  await importJson(page, 'mitreden-alle-saetze-2026-08-23.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'azure:de-DE-KatjaNeural' },
    { id: 'noch-eins', text: 'Noch eins.', collections: [], voice: 'piper:de_DE-thorsten-medium' },
  ]);
  await expect(page.locator('#s')).toContainText('2 hinzugefügt');
  // No key here, so Azure's voice is not one this page has. Saying so is the
  // difference between a picker that looks ignored and one that is explained.
  await expect(page.locator('#s')).toContainText('Bei 1 davon fehlt die Stimme');
  // Discounted rather than counted: an Azure voice winning this vote would fail
  // every recording in the Sammlung it won.
  expect(await voices(page))
    .toContainEqual(['mitreden-alle-saetze-2026-08-23', 'piper:de_DE-thorsten-medium']);
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
  expect(await voices(page))
    .toContainEqual(['mitreden-alle-saetze-2026-08-23', 'azure:de-DE-KatjaNeural']);
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
  // Nothing voted, so the Sammlung takes the settings voice — which nobody has
  // saved on a first visit, so it goes without one and follows the default.
  // Named for the file: readFile only takes a `collection` that is a string, and
  // bildhaft's is a record.
  expect(await voices(page)).toContainEqual(['bildhaft-gruffelo', null]);
});

/*
 * Two files with the same sentence used to make one row in two Sammlungen. They
 * make two rows now, one in each, because a sentence is in one Sammlung and
 * each Sammlung records in its own voice — which is the whole reason for the
 * second row: these two will not sound the same.
 */
test('the same sentence in two files lands in each Sammlung, in each voice', async ({ page }) => {
  await page.route(VOICE_LIST, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) }));
  await openData(page);
  await page.click('#p-azure > summary');
  await page.fill('#azurekey', '0'.repeat(32));
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });

  await importJson(page, 'erste.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'piper:de_DE-thorsten-medium' },
  ]);
  await expect(page.locator('#s')).toContainText('1 hinzugefügt');
  await importJson(page, 'zweite.json', [
    { id: 'ich-habe-hunger', text: 'Ich habe Hunger.', collections: [], voice: 'azure:de-DE-KatjaNeural' },
  ]);
  await expect(page.locator('#s')).toContainText('1 hinzugefügt, 0 gab es schon');

  expect(await stored(page), 'a row apiece').toEqual([
    ['Ich habe Hunger.', null], ['Ich habe Hunger.', null],
  ]);
  const held = await voices(page);
  expect(held).toContainEqual(['erste', 'piper:de_DE-thorsten-medium']);
  expect(held).toContainEqual(['zweite', 'azure:de-DE-KatjaNeural']);
});

/* Where a merge still happens: the same sentence twice inside one file, which
   would otherwise be two of the same thing in the same place. */
test('a file naming one sentence twice adds it once', async ({ page }) => {
  await openData(page);
  await importJson(page, 'doppelt.json', [
    { id: 'a', text: 'Ich habe Hunger.', collections: [] },
    { id: 'b', text: 'ich   habe hunger.', collections: [] },
  ]);
  await expect(page.locator('#s')).toContainText('1 hinzugefügt');
  await expect(page.locator('#s')).toContainText('1 gab es schon');
  expect(await stored(page)).toEqual([['Ich habe Hunger.', null]]);
});
