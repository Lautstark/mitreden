import { expect, test } from '@playwright/test';

/**
 * The question an Anybook export asks before it encodes anything.
 *
 * New on 2026-09-16, with the page's move to components, and the reason it is
 * new is worth writing down: this dialog had no coverage at all. It was the one
 * surface in the product reachable only with a recording in hand, so every
 * other spec here skipped it — and it is also the surface with the most state
 * in it, three answers that lean on each other and a map of the paper drawn
 * from all three. The rewrite had nothing to fail against.
 *
 * The recording is seeded rather than made. What the dialog needs is a sentence
 * whose clip exists; three bytes of nonsense is a clip for that purpose, and it
 * saves the 63 MB the real thing costs. Nothing here presses „Exportieren" —
 * the bytes would go to the MP3 encoder, and what this file is about is the
 * question, not the answer. `packPen` past this point is core/anybook.ts's, and
 * tests/unit/anybook-project.test.ts is where that lives.
 */

/* One Sammlung, one sentence, one clip. Written at the version the app is on,
   so nothing here is about migration — e2e/upgrade.spec.ts owns that, and it is
   where this seeding comes from. */
const SEEDED = `
  new Promise((keep, drop) => {
    const request = indexedDB.open('mitreden', 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      const phrases = database.createObjectStore('phrases', { keyPath: 'id' });
      phrases.createIndex('collections', 'collections', { multiEntry: true });
      phrases.createIndex('norm', 'norm');
      database.createObjectStore('collections', { keyPath: 'id' })
        .createIndex('updatedAt', 'updatedAt');
      database.createObjectStore('settings');
      database.createObjectStore('audio');
    };
    request.onerror = () => drop(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(
        ['phrases', 'collections', 'settings', 'audio'], 'readwrite');
      tx.objectStore('phrases').put({
        id: 'hunger', text: 'Ich habe Hunger.', norm: 'ich habe hunger.',
        collections: ['kueche'], voice: 'piper:de_DE-thorsten-medium',
        fingerprint: 'aaaaaaaaaaaa',
      });
      tx.objectStore('collections').put({ id: 'kueche', name: 'Küche', updatedAt: 1 });
      tx.objectStore('settings').put(
        { voice: 'piper:de_DE-thorsten-medium', open: ['kueche'] }, 'settings');
      tx.objectStore('audio').put(new Blob([new Uint8Array([1, 2, 3])]), 'hunger');
      tx.oncomplete = () => { database.close(); keep(); };
      tx.onerror = () => drop(tx.error);
    };
  })
`;

/** The dialog, open, with one recorded sentence behind it. */
async function ask(page: import('@playwright/test').Page) {
  /* The bundle is held off for the first visit, which is upgrade.spec.ts's
     trick and is here for its reason: the page makes the database itself on
     arrival, and a seed written afterwards is a seed written into a library
     that already exists at a later version. */
  await page.route('**/*.js', (route) => route.abort());
  await page.goto('/?lang=de');
  await page.evaluate(SEEDED);
  await page.unroute('**/*.js');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
  await expect(page.locator('.item')).toHaveCount(1);

  await page.click('#dlall');
  await page.locator('.menu button', { hasText: 'Anybook' }).click();
  const sheet = page.locator('dialog[open]');
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The counting panel, which is the second half of the same dialog. */
async function counting(sheet: import('@playwright/test').Locator) {
  await sheet.locator('.foot button', { hasText: 'Weiter' }).click();
  await expect(sheet.locator('.foot button', { hasText: 'Exportieren' })).toBeVisible();
  return sheet;
}

/** The circles, which are the only buttons inside the map's grid. */
const dots = (sheet: import('@playwright/test').Locator) =>
  sheet.locator('div[style*="grid-template-columns"] button');

test('opens on the remembered sheet, with the run drawn on the paper', async ({ page }) => {
  const sheet = await ask(page);
  // 6222 is the default, and 88 circles is what makes it that sheet rather
  // than the other one — the geometry comes from core/anybook.ts and this is
  // the one place it reaches the screen.
  await expect(dots(sheet)).toHaveCount(88);
  await expect(sheet.locator('.segmented button[aria-pressed="true"]')).toContainText('6222');
  await expect(sheet).toContainText('ab Position 1');
  await expect(sheet).toContainText('passt auf einen Bogen');
});

test('the three answers move together, because each one changes the others', async ({ page }) => {
  const sheet = await ask(page);
  const summary = sheet.locator('p.hint').filter({ hasText: 'Position' });

  /* Where this run starts is clicked on the paper rather than counted to: a
     part-used sheet is the case the number field alone was bad at. */
  await dots(sheet).nth(29).click();
  await expect(sheet.locator('#penstart')).toHaveValue('30');
  await expect(summary).toContainText('ab Position 30');

  // And typing it is still the other way in, with the same answer.
  await sheet.locator('#penstart').fill('7');
  await expect(summary).toContainText('ab Position 7');

  // The start code spends a circle, so the sentence about the run changes too.
  await expect(summary).toContainText('mit Startcode');
  await sheet.locator('input[type=checkbox]').uncheck();
  await expect(summary).toContainText('ohne Startcode');

  /* The other sheet is 315 circles and its own paper. The start survives the
     switch where it can — seven is a position on both — and the map is redrawn
     around it rather than the dialog being reopened. */
  await sheet.locator('.segmented button', { hasText: 'L6019' }).click();
  await expect(dots(sheet)).toHaveCount(315);
  await expect(sheet.locator('p.hint').filter({ hasText: 'Etiketten' })).toContainText('L6019');
  await expect(sheet.locator('#penstart')).toHaveValue('7');
});

test('a start past the end of the chosen sheet is refused rather than exported', async ({ page }) => {
  const sheet = await ask(page);
  // 88 circles, so 400 is not a position. It is pulled back to the last one
  // rather than accepted — an export beginning past the paper is a run with
  // nowhere to go, and Studio would not say so.
  await sheet.locator('#penstart').fill('400');
  await expect(sheet.locator('#penstart')).toHaveValue('88');
});

test('the second step counts stickers, not sentences', async ({ page }) => {
  /*
   * The Klettspiel case, as small as it goes: one sentence that wants more
   * than one sticker. The numbers under the list are the point of the panel —
   * thirty stickers of eighty-eight is a sheet and ninety is two, and that is
   * a decision somebody makes before printing rather than after.
   */
  const sheet = await counting(await ask(page));
  const count = sheet.locator('input[type=number]');
  await expect(count).toHaveValue('1');
  // One sticker and the activation code ahead of it.
  await expect(sheet).toContainText('1 Aufkleber · 2 Kreise');

  await sheet.locator('button[aria-label*="Ein Aufkleber mehr"]').click();
  await sheet.locator('button[aria-label*="Ein Aufkleber mehr"]').click();
  await expect(count).toHaveValue('3');
  await expect(sheet).toContainText('3 Aufkleber · 4 Kreise');
  await expect(sheet).toContainText('danach sind 84 Kreise frei');

  // Typing it is the other way in, and nothing below one is printable.
  await count.fill('0');
  await expect(sheet).toContainText('1 Aufkleber · 2 Kreise');

  // All at once, and back to what the sentences actually hold.
  await sheet.locator('.segmented button', { hasText: 'Alle 2×' }).click();
  await expect(count).toHaveValue('2');
  await sheet.locator('.segmented button', { hasText: 'Wie gespeichert' }).click();
  await expect(count).toHaveValue('1');
});

test('the counts and the paper are the same question, so going back keeps both', async ({ page }) => {
  const sheet = await counting(await ask(page));
  await sheet.locator('input[type=number]').fill('4');

  await sheet.locator('.foot button', { hasText: 'Zurück' }).click();
  // The map is back, and it is drawn around the four stickers rather than one:
  // the sheet question and the counting question answer each other.
  await expect(dots(sheet)).toHaveCount(88);
  await sheet.locator('#penstart').fill('86');
  await expect(sheet.locator('p.hint').filter({ hasText: 'Position' }))
    .toContainText('braucht 2 Bögen');

  // And what was typed into the other panel is still there.
  await counting(sheet);
  await expect(sheet.locator('input[type=number]')).toHaveValue('4');
});

test('Abbrechen closes it and exports nothing', async ({ page }) => {
  const sheet = await ask(page);
  const downloads: string[] = [];
  page.on('download', (one) => downloads.push(one.suggestedFilename()));

  await sheet.locator('.foot button', { hasText: 'Abbrechen' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // The dialog is built per opening and taken out of the document on the way
  // out — every one of them, or a page left standing for an afternoon collects
  // one <dialog> per export anybody thought better of.
  await expect(page.locator('dialog:not([id])')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(downloads).toEqual([]);
});
