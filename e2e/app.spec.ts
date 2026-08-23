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

test('every setting states itself in its own heading, before it is opened', async ({ page }) => {
  // Read in the same tick as the click: a heading fetched from the database
  // was blank for a frame, which is blank at the moment somebody looks. The
  // component's rule is that "Wird geladen …" is a state and empty is not.
  const atOpen = await page.evaluate(() => {
    document.getElementById('gear')!.click();
    return ['voicestate', 'azurestate', 'langstate', 'datastate']
      .map((id) => document.getElementById(id)!.textContent ?? '');
  });
  expect(atOpen.filter((text) => text.trim() === '')).toEqual([]);

  await expect(page.locator('#setup')).toBeVisible();

  // The point of the shape: the headings answer the common questions without
  // anything being unfolded. A tab could not do this — it only promises.
  await expect(page.locator('#voicestate')).toContainText('Deutsch');
  await expect(page.locator('#azurestate')).toHaveText('Kein Schlüssel');
  await expect(page.locator('#langstate')).toHaveText('Deutsch');
  await expect(page.locator('#datastate')).toHaveText('Noch keine Sätze');

  // And each one opens onto the controls it named.
  for (const [panel, marker] of [
    ['p-azure', '#azurekey'], ['p-lang', '#lang'], ['p-data', '#export'], ['p-wipe', '#wipe'],
  ] as const) {
    await page.click(`#${panel} > summary`);
    await expect(page.locator(marker)).toBeVisible();
  }
  // The one the compiler could not check: a sentence saying what the picker does.
  await expect(page.locator('[data-i18n="language_hint"]')).not.toBeEmpty();
});

test('the headings follow what they describe', async ({ page }) => {
  await page.fill('#t', 'Ein Satz.');
  await page.click('#add');
  await expect(page.locator('.item .line')).toHaveText('Ein Satz.');
  await page.click('#gear');
  await expect(page.locator('#datastate')).toHaveText('1 Satz');
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

test('the rail can be put away, and stays away', async ({ page }) => {
  const rail = page.locator('#rail');
  await expect(rail).toBeInViewport();
  await page.click('#railhide');
  await expect(rail).not.toBeInViewport();
  // Something has to bring it back, or putting it away is a trap.
  await expect(page.locator('#railshow')).toBeVisible();
  // The choice is about the shape of the window, so it is not re-made per visit.
  await page.reload();
  await expect(rail).not.toBeInViewport();
  await page.click('#railshow');
  await expect(rail).toBeInViewport();
  await page.reload();
  await expect(rail).toBeInViewport();
});

test('the voice is named beside the composer and chosen in the settings', async ({ page }) => {
  // Which voice records is a fact the page states, not a control beside every
  // sentence — and it says where the voice comes from and what it speaks.
  await expect(page.locator('#voicename')).not.toBeEmpty();
  await expect(page.locator('#voicefrom')).toContainText('Deutsch');

  await page.click('#voicepick');
  await expect(page.locator('#setup')).toBeVisible();
  // The way in from the composer unfolds the panel it is a way in to.
  await expect(page.locator('#p-voice')).toHaveAttribute('open', '');
  const rows = page.locator('#voices .voice');
  await expect(rows.first()).toBeVisible();
  const many = await rows.count();

  // Narrowing is the whole reason it is a list rather than a select: shipped
  // voices alone run to dozens, and an Azure key adds hundreds.
  await page.fill('#voiceq', 'thorsten');
  await expect(rows).not.toHaveCount(many);
  await expect(page.locator('#voices .voice__name').first()).toContainText('Thorsten');
  await page.fill('#voiceq', 'gibtsnicht');
  await expect(page.locator('#voices')).toContainText('Keine Stimme');
  await page.fill('#voiceq', '');

  // Picking marks the row it was made on and renames the line outside. It is a
  // radio group: one choice with several answers, not a row of toggles that
  // happen to agree, and a bare `aria-checked=""` would match neither the CSS
  // nor a screen reader.
  const second = rows.nth(1);
  const name = await second.locator('.voice__name').innerText();
  await second.click();
  await expect(second).toHaveAttribute('aria-checked', 'true');
  // The heading above the list names the voice in force, so it moves too.
  await expect(page.locator('#voicestate')).toContainText(name);
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#voices')).toHaveAttribute('role', 'radiogroup');
  // A list this long has to be walkable without seventeen presses of Tab.
  await second.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'true');
  await rows.nth(2).press('ArrowUp');
  await expect(second).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#voicename')).toHaveText(name);
  await page.reload();
  await expect(page.locator('#voicename')).toHaveText(name);
});

test('the two menus in the head are one shape', async ({ page }) => {
  // Herunterladen was a native select and the ⋯ beside it was not, so the two
  // drew themselves differently in every theme. Both open the same menu now.
  await page.click('#dlall');
  await expect(page.locator('.menu button', { hasText: 'MP3' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);
  await page.click('#colmore');
  await expect(page.locator('.menu button.danger')).toBeVisible();
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
