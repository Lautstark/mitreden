import { expect, type Page } from '@playwright/test';

/*
 * The settings sheet, as the specs walk it since 2026-10-31: three panels —
 * „Sprache & Aussehen" (#p-look, open on arrival), „Standardstimme" (#p-voice)
 * and „Deine Daten" (#p-data). Azure is no panel of its own any more: it is
 * stimmquelle's AzureConnection under the voice list, `#azure`, a box saying
 * whether it is connected and one button that unfolds the key and the region.
 */

/** „Andere Stimme …": the button a folded VoicePicker shows under the chosen
 *  voice. `btn sm` and not `btn quiet sm`, which is „Zuklappen". */
const OTHER = '#voices .voice-picker > .acts .btn:not(.quiet)';

/** Opens „Standardstimme". The sheet has to be open already. */
export async function openVoicePanel(page: Page): Promise<void> {
  await page.click('#p-voice > summary');
  await expect(page.locator('#p-voice')).toHaveJSProperty('open', true);
}

/**
 * With a voice chosen the picker shows only that one and „Andere Stimme …"
 * (stimmquelle 2.15.0's `folded`). This asks for the search and the rows. A
 * row clicked afterwards is a choice made, and folds them away again; the
 * arrow keys do not.
 */
export async function unfoldVoices(page: Page): Promise<void> {
  await page.locator(OTHER).click();
  await expect(page.locator('#voices input[type=search]')).toBeVisible();
}

/** The one button under the Azure box: „Verbinden …", „Ändern …" or
 *  „Schlüssel und Region prüfen …", whichever the state calls for. It opens
 *  the key and region fields. */
export async function openAzureForm(page: Page): Promise<void> {
  await page.click('#azure > .acts button');
  await expect(page.locator('#azurekey')).toBeVisible();
}

/** The Azure box itself: `data-state` is `off`, `loading`, `ready` or
 *  `failed`, and its text says the same in words. */
export const azureBox = (page: Page) => page.locator('#azure .where');
