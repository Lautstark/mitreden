import { expect, test } from '@playwright/test';

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
 * Nothing here records. Proving a voice speaks costs a 63 MB model and
 * audio.spec.ts pays that once; what goes wrong in this area is a page naming
 * one voice and recording in another, which is decided long before any audio.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('the line names the Sammlung’s voice, and Ändern leads to where that one changes', async ({ page }) => {
  // The caption is the half that makes one button with two destinations honest:
  // it says which of the two answers the name beside it came from.
  await expect(page.locator('#voicewhat')).toHaveText('Stimme der Sammlung');
  const named = await page.locator('#voicename').innerText();

  await page.click('#voicepick');
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

  await page.fill('#colvoiceq', 'kerstin');
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
  await expect(page.locator('#voicepick')).toHaveAttribute('aria-label', 'Standardstimme ändern');

  await page.click('#voicepick');
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#p-voice')).toHaveAttribute('open', '');
  await expect(page.locator('#colvoice')).not.toBeVisible();
  // The panel says what it is for, so nobody reads it as the voice recording now.
  await expect(page.locator('#p-voice .section')).toHaveText('Standardstimme');
  await expect(page.locator('#p-voice .hint')).toContainText('nächste neue Sammlung');
});

test('the ⋯ holds what the Sammlung is set to, under what acts on it', async ({ page }) => {
  // conventions.md §3.6, amended: the menu beside the name holds a Sammlung's
  // settings as well as the acts on it, and the order is what keeps the two
  // legible — the acts, then what it is set to, then the delete.
  await page.click('#colmore');
  const items = page.locator('.menu button');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toHaveText('Sammlung neu aufnehmen');
  await expect(items.nth(1)).toHaveText('Sammlung exportieren');
  await expect(items.nth(2)).toContainText('Stimme der Sammlung');
  await expect(items.nth(3)).toHaveClass(/danger/);
});

test('the sheet says what a different voice costs, before it is pressed', async ({ page }) => {
  // Said rather than confirmed. A voice destroys nothing — every clip stays and
  // goes on playing — so what is owed is the sentence about what changes, with
  // the number in it, and not a dialog asking permission.
  await page.fill('#t', 'Ich habe Hunger.\nIch will noch nicht ins Bett.');
  await page.click('#add');
  await expect(page.locator('.item')).toHaveCount(2);

  await page.click('#voicepick');
  await expect(page.locator('#colvoicecost')).toContainText('2 Sätze');
  await expect(page.locator('#colvoicecost')).toContainText('neu aufnehmen');
  // And no question in the way of the press.
  await expect(page.locator('#colvoice .foot')).toHaveCount(0);
});
