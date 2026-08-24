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
  await page.click('#colmore');
  await page.click('.menu button.danger');

  /* The question is a sheet in the page now rather than the browser's own
     confirm, so it is pressed rather than accepted. The destructive button is
     found by its class instead of its words, because this page has two
     languages and the runner picks one. */
  const question = page.locator('dialog[open]');
  await expect(question).toBeVisible();
  await question.locator('.foot button.destructive').click();
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
  await expect(page.locator('#p-data > summary .section')).toHaveText('Daten');

  // And each one opens onto the controls it named.
  for (const [panel, marker] of [
    ['p-azure', '#azurekey'], ['p-lang', '#lang'], ['p-data', '#export'],
  ] as const) {
    await page.click(`#${panel} > summary`);
    await expect(page.locator(marker)).toBeVisible();
  }
  // A backup and a reset are one subject — what becomes of everything you have —
  // so they share a panel, as bildhaft's Daten does. Reading about the one is
  // how somebody finds the other.
  await expect(page.locator('#p-data #wipe')).toBeVisible();
  // The one the compiler could not check: a sentence saying what the picker does.
  await expect(page.locator('[data-i18n="language_hint"]')).not.toBeEmpty();
});

test('the page language is a menu like every other choice on the page', async ({ page }) => {
  await page.click('#gear');
  await page.click('#p-lang > summary');
  // It was the last native <select>, drawing its own chevron from a hex baked
  // into a data URI — the one control that could not follow the theme.
  await expect(page.locator('#lang')).toHaveJSProperty('tagName', 'BUTTON');
  await page.click('#lang');
  // Hung from its own left edge: right-aligned, a 190px menu on a 90px button
  // at the left of a panel reached back past the edge of the sheet.
  const menu = page.locator('#p-lang .menu');
  await expect(menu).toBeVisible();
  const [box, sheet] = await Promise.all([menu.boundingBox(), page.locator('#setup').boundingBox()]);
  expect(box!.x).toBeGreaterThanOrEqual(sheet!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(sheet!.x + sheet!.width);

  await menu.getByText('English').click();
  await expect(page.locator('#lang')).toHaveText('English');
  await expect(page.locator('#langstate')).toHaveText('English');
  await expect(page.locator('#setup > .head h2')).toHaveText('Settings');
  // Without the ?lang= these tests open with — an explicit URL outranks the
  // stored choice, and should — the page comes back in the language it was left.
  await page.goto('/');
  await expect(page.locator('.chint')).toContainText('records');
});

test('the caption spans the composer, both ends on the same edge', async ({ page }) => {
  // It followed the composer's own padding, which is 20px left and 16px right —
  // asymmetric because a round send button needs less inset than text does. A
  // caption has no such reason, and it read as starting further in than it
  // ended. What is measured is what the eye reads: the key's background on the
  // left, and on the right the word rather than the transparent box round it.
  const ends = await page.evaluate(() => {
    const box = document.querySelector('.compose')!.getBoundingClientRect();
    const kbd = document.querySelector('.chint kbd')!.getBoundingClientRect();
    const btn = document.getElementById('voicepick')!.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(document.getElementById('voicepick')!).paddingRight);
    return { left: Math.round(kbd.left - box.left), right: Math.round(box.right - (btn.right - pad)) };
  });
  expect(ends.left).toBe(0);
  expect(ends.right).toBe(0);

  // And one baseline. The right half ends in a padded button, so it is twice
  // the height of the left; a flex row left to stretch put one at the top of
  // the line and centred the other 7px below it. Measured on the text itself,
  // by range — an element box includes padding and would hide the difference.
  const drift = await page.evaluate(() => {
    const baseline = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().top;
    };
    const keys = document.querySelector('.chint > span')!;
    const words = [...keys.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim())!;
    return Math.abs(baseline(words) - baseline(document.querySelector('.voicenow__what')!));
  });
  expect(drift).toBeLessThan(1);
});

test('the caption stays on one line, whatever the voice is called', async ({ page }) => {
  // An Azure name is long enough to send the voice line to a row of its own,
  // which is what wrapping looked like. What gives way is where the voice comes
  // from; the name and the alignment hold.
  const sameLine = await page.evaluate(() => {
    document.getElementById('voicename')!.textContent = 'de-DE-SeraphinaMultilingualNeural';
    document.getElementById('voicefrom')!.textContent = 'Azure · Englisch (Vereinigte Staaten)';
    // Sharing a line, not sharing a top edge: the two are centred differently
    // inside it, so what has to be true is that they overlap vertically.
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    return box('.voicenow').top < box('.chint kbd').bottom;
  });
  expect(sameLine).toBe(true);
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

test('the picker offers a German woman and an English man', async ({ page }) => {
  // The two slots that stood empty until this page drove piper itself, and the
  // reason usePiperRuntime() is wired up at all. Neither voice can be reached
  // through vits-web — it phonemises every model against one fixed symbol
  // table, which no `low` model was trained on, and John is not in its path
  // map at all — so both are here only because src/core/audio.ts owns the
  // three steps and src/core/voices.ts says so with { ownsInference: true }.
  //
  // The list is the assertion and no sentence is recorded: proving Kerstin
  // speaks costs 63 MB, and audio.spec.ts already pays that once for the
  // shared path. What this catches is the claim going missing from the
  // catalogue call, which is what empties both slots again.
  await page.click('#voicepick');
  await expect(page.locator('#p-voice')).toHaveAttribute('open', '');

  await page.fill('#voiceq', 'kerstin');
  const kerstin = page.locator('#voices .voice').first();
  await expect(kerstin.locator('.voice__name')).toHaveText('Kerstin');
  // What she costs and who she is: the facts a slot is empty without.
  await expect(kerstin.locator('.voice__facts')).toContainText('weiblich');
  await expect(kerstin.locator('.voice__facts')).toContainText('63 MB');

  await page.fill('#voiceq', 'john');
  const john = page.locator('#voices .voice').first();
  await expect(john.locator('.voice__name')).toHaveText('John');
  await expect(john.locator('.voice__facts')).toContainText('männlich');

  // And the licence half is untouched by the runtime claim: de_DE-mls-medium
  // is CC-BY, this page renders no notices, so it is still not on offer.
  await page.fill('#voiceq', 'mls');
  await expect(page.locator('#voices')).toContainText('Keine Stimme');
});

test('a voice that rushes single words says so on its own row', async ({ page }) => {
  // The case a talker is mostly made of: one word on one key. The voice the
  // catalogue flags renders a word with no terminal punctuation at a near-fixed
  // span whatever the word is, so "Nein" gets the same slot as "Ja" — which is
  // invisible in every test sentence, because a sentence is fine.
  //
  // Nothing is recorded here. Proving the timing costs a 63 MB model, and the
  // measurement is stimmquelle's to hold; what this covers is the flag reaching
  // the screen, which is the failure mode a note has — being rendered nowhere,
  // or being rendered on every row, and both look like working software.
  await page.click('#voicepick');
  await expect(page.locator('#p-voice')).toHaveAttribute('open', '');

  await page.fill('#voiceq', 'kerstin');
  const kerstin = page.locator('#voices .voice').first();
  const note = kerstin.locator('.voice__hint');
  // Visible, not merely present: an invisible note is the same as no note, and
  // this one wraps to a second line inside a button that does not wrap by
  // default. Its own words rather than the flag's, which carries none.
  await expect(note).toBeVisible();
  await expect(note).toContainText('Satzzeichen');

  // And on that row alone. The catalogue decides who carries the trait, so a
  // page that showed it everywhere would be as wrong as one that showed it
  // nowhere — and would pass every assertion above.
  await page.fill('#voiceq', 'thorsten');
  await expect(page.locator('#voices .voice').first().locator('.voice__name'))
    .toContainText('Thorsten');
  await expect(page.locator('#voices .voice__hint')).toHaveCount(0);

  // And exactly once across the unfiltered catalogue, which is the assertion
  // that would fail if the flag were being read off something every row has.
  await page.fill('#voiceq', '');
  await expect(page.locator('#voices .voice__hint')).toHaveCount(1);
});

test('the voice follows the words, until somebody has chosen one', async ({ page }) => {
  // The shipped catalogue opens with three German voices, so taking the first
  // of it read English aloud in a German man's voice and went on doing it.
  await expect(page.locator('#voicename')).toHaveText('Thorsten (medium)');
  await expect(page.locator('#voicefrom')).toContainText('Deutsch');

  await page.click('#gear');
  await page.click('#p-lang > summary');
  await page.click('#lang');
  await page.locator('#p-lang .menu').getByText('English').click();
  // Nobody had said which voice, so the German one was this page's guess about
  // what it would be asked to read — and the guess has just been answered.
  await expect(page.locator('#voicename')).toHaveText('Kristin');
  await expect(page.locator('#voicefrom')).toContainText('English');

  // Without the ?lang= these tests open with, so the stored English stands.
  await page.goto('/');
  await expect(page.locator('#voicename')).toHaveText('Kristin');

  // A chosen voice is nobody's guess. It stays through a change of words, in
  // either direction: a German voice on an English page is an arrangement
  // somebody made, not a mistake to be corrected on their behalf.
  await page.click('#voicepick');
  await page.fill('#voiceq', 'Thorsten (emotional)');
  await page.locator('#voices .voice').first().click();
  await expect(page.locator('#voicename')).toHaveText('Thorsten (emotional)');
  await page.click('#p-lang > summary');
  await page.click('#lang');
  await page.locator('#p-lang .menu').getByText('Deutsch').click();
  await expect(page.locator('#voicename')).toHaveText('Thorsten (emotional)');
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
