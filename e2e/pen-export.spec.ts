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
      if (RECORDED) tx.objectStore('audio').put(new Blob([new Uint8Array([1, 2, 3])]), 'hunger');
      tx.oncomplete = () => { database.close(); keep(); };
      tx.onerror = () => drop(tx.error);
    };
  })
`;

/** The dialog, open, with one recorded sentence behind it. */
async function ask(
  page: import('@playwright/test').Page, { recorded = true }: { recorded?: boolean } = {},
) {
  /* The bundle is held off for the first visit, which is upgrade.spec.ts's
     trick and is here for its reason: the page makes the database itself on
     arrival, and a seed written afterwards is a seed written into a library
     that already exists at a later version. */
  await page.route('**/*.js', (route) => route.abort());
  await page.goto('/?lang=de');
  /* The seed is an expression, so the one flag it reads is wrapped around it
     rather than declared before it. */
  await page.evaluate(`(() => { const RECORDED = ${recorded}; return (${SEEDED}); })()`);
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

/** The one sentence's sticker count. Named rather than taken as "the number
 *  field", because the paper's own „Erster freier Aufkleber" is one too — they
 *  sit in one sheet now. */
const copies = (sheet: import('@playwright/test').Locator) =>
  sheet.locator('input[aria-label^="Aufkleber für"]');

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
  /* Where the run begins is the field's own value — it used to be repeated in
     a sentence under the map, which was one more thing to keep true. */
  await expect(sheet.locator('#penstart')).toHaveValue('1');
  // And what it costs is in the foot, which is the part that never scrolls.
  await expect(sheet.locator('.foot')).toContainText('passt auf einen Bogen');
});

test('the three answers move together, because each one changes the others', async ({ page }) => {
  const sheet = await ask(page);
  const foot = sheet.locator('.foot');

  /* Where this run starts is clicked on the paper rather than counted to: a
     part-used sheet is the case the number field alone was bad at. */
  await dots(sheet).nth(29).click();
  await expect(sheet.locator('#penstart')).toHaveValue('30');

  /* And typing it is still the other way in. The last circle of the sheet
     leaves no room for a sticker *and* its start code, so the run spills onto
     a second sheet — which the foot says before anything is encoded. */
  await sheet.locator('#penstart').fill('88');
  await expect(foot).toContainText('braucht 2 Bögen');
  await sheet.locator('#penstart').fill('7');
  await expect(foot).toContainText('passt auf einen Bogen');

  /* The start code spends a circle of its own, so taking it off is one circle
     fewer for the same sentence. Counted from the top of the sheet, where the
     only two circles in the run are the code and the sticker. */
  await sheet.locator('#penstart').fill('1');
  await expect(foot).toContainText('1 Aufkleber · 2 Kreise');
  await sheet.locator('input[type=checkbox]').uncheck();
  await expect(foot).toContainText('1 Aufkleber · 1 Kreis');

  /* The other sheet is 315 circles and its own paper. The start survives the
     switch where it can — seven is a position on both — and the map is redrawn
     around it rather than the dialog being reopened. */
  await sheet.locator('#penstart').fill('7');
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

test('counts stickers, not sentences', async ({ page }) => {
  /*
   * The Klettspiel case, as small as it goes: one sentence that wants more
   * than one sticker. The numbers under the list are the point of it —
   * thirty stickers of eighty-eight is a sheet and ninety is two, and that is
   * a decision somebody makes before printing rather than after.
   */
  const sheet = await ask(page);
  const count = copies(sheet);
  await expect(count).toHaveValue('1');
  // One sticker and the activation code ahead of it.
  await expect(sheet).toContainText('1 Aufkleber · 2 Kreise');

  await sheet.locator('button[aria-label*="Ein Aufkleber mehr"]').click();
  await sheet.locator('button[aria-label*="Ein Aufkleber mehr"]').click();
  await expect(count).toHaveValue('3');
  await expect(sheet).toContainText('3 Aufkleber · 4 Kreise');
  await expect(sheet).toContainText('danach sind noch 84 Kreise frei');

  // Typing it is the other way in, and nothing below one is printable.
  await count.fill('0');
  await expect(sheet).toContainText('1 Aufkleber · 2 Kreise');

  /* And no bank of quick choices over the list. It was three actions drawn as
     a segmented control — a shape that says "one of these is the current one"
     about three things that are none of them a state, so it sat there looking
     broken with nothing selected. The list already opens on what the sentences
     hold, which is one each where nobody has said otherwise.

     Named, not counted: the one segmented control left in this sheet is the
     paper, which is a genuine either/or and belongs in that shape. */
  for (const label of ['Alle 1×', 'Alle 2×', 'Wie gespeichert']) {
    await expect(sheet.locator('button', { hasText: label })).toHaveCount(0);
  }
});

/*
 * One question, not two steps.
 *
 * It was two panels with „Weiter" between them, and the two halves answer each
 * other: how many stickers decides how much paper, and where on the paper the
 * run starts decides whether they fit. Asking them a page apart meant pressing
 * Weiter and Zurück to see what a number did — and the second panel's „Weiter"
 * was below a map of 315 circles, so on a laptop it could not be reached
 * without scrolling the whole dialog, buttons and all.
 */
test('the paper and the counts are on one sheet, and answer each other', async ({ page }) => {
  const sheet = await ask(page);
  // No step between them: both are here, and there is nothing to press to get
  // from one to the other.
  await expect(dots(sheet)).toHaveCount(88);
  await expect(copies(sheet)).toHaveCount(1);
  await expect(sheet.locator('.foot button', { hasText: 'Weiter' })).toHaveCount(0);

  // Four stickers from circle 86 is more than this sheet has left, and the
  // sentence about the paper says so while the number is being typed.
  await copies(sheet).fill('4');
  await sheet.locator('#penstart').fill('86');
  await expect(sheet).toContainText('braucht 2 Bögen');
});

/*
 * And the way out is always on screen.
 *
 * The small sheet is 315 circles, which made the dialog taller than a laptop:
 * the whole thing scrolled, so „Abbrechen" and „Exportieren" went with it and
 * the reader had to scroll past the paper to find them. The frame caps the
 * height already — components.css says the scrolling itself "stays per
 * product", and this is the product doing it.
 */
test('the buttons stay on screen however much paper is drawn', async ({ page }) => {
  const sheet = await ask(page);
  await sheet.locator('.segmented button', { hasText: 'L6019' }).click();
  await expect(dots(sheet)).toHaveCount(315);

  for (const label of ['Abbrechen', 'Exportieren']) {
    await expect(sheet.locator('.foot button', { hasText: label })).toBeInViewport();
  }
  // The sheet itself fits; what scrolls is its body.
  const fits = await sheet.evaluate((node) =>
    node.getBoundingClientRect().bottom <= window.innerHeight + 1);
  expect(fits, 'the dialog is taller than the window').toBe(true);
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

/*
 * A Sammlung with nothing recorded in it yet.
 *
 * The menu offers „Als Anybook-Projekt …" whether or not there is anything to
 * put on a sticker, and pressing it used to answer with one grey line —
 * „Davon ist nichts aufgenommen." — which from where the reader sits is a
 * button that does nothing. It is also the one case with an obvious next step,
 * since the thing missing is exactly what this product makes.
 */
test('offers the recording when there is nothing to put on a sticker', async ({ page }) => {
  await ask(page, { recorded: false });

  const question = page.locator('dialog[open]');
  await expect(question).toBeVisible();
  await expect(question).toContainText('aufgenommen');
  // The answer is the recording, not an apology, and it is the primary button.
  await expect(question.locator('.foot button.primary')).toContainText('aufnehmen');

  // And declining leaves the Sammlung exactly as it was.
  await question.locator('.foot button:not(.primary)').first().click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#list .item.busy')).toHaveCount(0);
});
