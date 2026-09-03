import { expect, test, type Page } from '@playwright/test';

/**
 * Which voice records, now that the answer belongs to the Sammlung.
 *
 * The model moved at 526905c and the screens did not: the line under the
 * composer read the settings voice, and „Ändern" beside it opened a picker that
 * no longer governed what the line said. What these cover is the three surfaces
 * agreeing — the line states what the next recording gets, the ⋯ beside the
 * name is where a Sammlung's own is changed, and Einstellungen keeps the
 * default that a new Sammlung starts with.
 *
 * That „Ändern" is gone as of 2026-08-29. It led to two different places
 * depending on where the next sentence would land, and the caption beside it
 * was what made that honest — an arrangement the code had to argue for in two
 * files. The line only states now, and each of the two answers has one door:
 * a Sammlung's is its ⋯, the default is Einstellungen.
 *
 * Nothing here records. Proving a voice speaks costs a 63 MB model and
 * audio.spec.ts pays that once; what goes wrong in this area is a page naming
 * one voice and recording in another, which is decided long before any audio.
 */

/** The one door to a Sammlung's own settings: the ⋯ beside its name. */
async function openCollectionSettings(page: Page): Promise<void> {
  await page.click('#colmore');
  await page.locator('.menu button', { hasText: 'Einstellungen dieser Sammlung' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('the line names the Sammlung’s voice, and the ⋯ is where that one changes', async ({ page }) => {
  // The caption says which of the two answers the name beside it came from.
  // It used to also be what made one button with two destinations honest; it
  // now earns its place on the first half alone.
  await expect(page.locator('#voicewhat')).toHaveText('Stimme der Sammlung');
  const named = await page.locator('#voicename').innerText();

  // And the line is a statement: nothing in it is pressable.
  await expect(page.locator('.voicenow button')).toHaveCount(0);

  await openCollectionSettings(page);
  await expect(page.locator('#colvoice')).toBeVisible();
  // And not the app's settings, which is where it used to lead.
  await expect(page.locator('#setup')).not.toBeVisible();
  await expect(page.locator('#colvoicelead')).toContainText('Sammlung vom');

  /* A Sammlung made before anybody picked a voice has none of its own and
     records in the default. The sheet marks that as the answer rather than
     marking nothing: the line outside it names the same voice, and a list with
     nothing checked would have the two contradicting each other. */
  await expect(page.locator('#colvoices .voice[aria-checked="true"] .voice__name'))
    .toHaveText(named);

  await page.fill('#colvoices input[type=search]', 'kerstin');
  await page.locator('#colvoices .voice').first().click();
  await expect(page.locator('#colvoices .voice[aria-checked="true"] .voice__name'))
    .toHaveText('Kerstin');
  // Live apply: the line behind the sheet has already changed, with no Save.
  await expect(page.locator('#voicename')).toHaveText('Kerstin');

  await page.click('#colvoiceclose');
  await page.reload();
  await expect(page.locator('#voicename')).toHaveText('Kerstin');
  await expect(page.locator('#voicewhat')).toHaveText('Stimme der Sammlung');
});

test('with two open, the next sentence is in none — and both halves say so', async ({ page }) => {
  /* composer.ts puts a new sentence in no Sammlung when two are open, because
     guessing which of them was meant is worse than asking. Such a sentence
     records in the default, so the line has to name the default and the way
     through has to lead to where *that* is changed. */
  await page.click('#newcol');
  await page.fill('#colname', 'Beim Essen');
  await expect(page.locator('#rows .collections__name', { hasText: 'Beim Essen' })).toBeVisible();

  const rows = page.locator('#rows .collections__item');
  await rows.first().click();
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });

  await expect(page.locator('#voicewhat')).toHaveText('Standardstimme');
  // No door in the line, for either answer. This is the case the old button
  // handled by changing where it led, which is exactly what it stopped doing.
  await expect(page.locator('.voicenow button')).toHaveCount(0);

  // The default's door is Einstellungen, and it opens on the voice panel.
  await page.click('#gear');
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#colvoice')).not.toBeVisible();
  // The panel says what it is for, so nobody reads it as the voice recording now.
  await expect(page.locator('#p-voice .section')).toHaveText('Standardstimme');
  await expect(page.locator('#p-voice .hint')).toContainText('nächste neue Sammlung');
});

test('the ⋯ holds what the Sammlung is set to, under what acts on it', async ({ page }) => {
  // conventions.md §3.6, amended: the menu beside the name holds a Sammlung's
  // settings as well as the acts on it, and the order is what keeps the two
  // legible — the acts, then what it is set to, then the delete.
  //
  // Three, which is vorlaut's list exactly. The fourth was „Sammlung neu
  // aufnehmen" at the top; it is a button in the settings sheet now, where the
  // voice that makes recordings stale is chosen.
  await page.click('#colmore');
  const items = page.locator('.menu button');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText('Sammlung exportieren');
  await expect(items.nth(1)).toContainText('Einstellungen dieser Sammlung');
  await expect(items.nth(2)).toHaveClass(/danger/);
});

test('the sheet says what a different voice costs, before it is pressed', async ({ page }) => {
  // Said rather than confirmed. A voice destroys nothing — every clip stays and
  // goes on playing — so what is owed is the sentence about what changes, with
  // the number in it, and not a dialog asking permission.
  await page.fill('#t', 'Ich habe Hunger.\nIch will noch nicht ins Bett.');
  await page.click('#add');
  await expect(page.locator('.item')).toHaveCount(2);

  await openCollectionSettings(page);
  await expect(page.locator('#colvoicecost')).toContainText('2 Sätze');
  // The cost line used to end by naming a menu item to go and press. The act
  // is on this sheet now, so the line states the cost and stops.
  await expect(page.locator('#colvoicecost')).not.toContainText('Menü');
  // And no question in the way of the press.
  await expect(page.locator('#colvoice .foot')).toHaveCount(0);
});

test('the sheet carries the re-record, and says how many it would speak', async ({ page }) => {
  // The button vorlaut's grid button is the precedent for: it names what the
  // press would do rather than saying „Speichern", and it is dead when the
  // press would do nothing — which is the common case, and was a permanently
  // present menu item announcing „Alles hier ist schon … aufgenommen".
  await page.fill('#t', 'Ich habe Hunger.\nIch will noch nicht ins Bett.');
  await page.click('#add');
  await expect(page.locator('.item')).toHaveCount(2);

  const button = page.locator('#colvoicerecord');

  // Nothing was ever recorded here — there is no voice on this page — so both
  // sentences are outstanding and the button counts them.
  await openCollectionSettings(page);
  await expect(button).toHaveText('2 Sätze neu aufnehmen');
  await expect(button).toBeEnabled();
});
