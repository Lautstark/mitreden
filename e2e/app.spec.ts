import { expect, test } from '@playwright/test';

/**
 * The page as somebody uses it. No recording happens here — that needs a 60 MB
 * model — so these cover everything up to and around it: the sentence is kept,
 * the Sammlung can be made, named and thrown away, and the dialog opens.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('opens with one Sammlung and nothing in it', async ({ page }) => {
  await expect(page.locator('#rows .collections__item')).toHaveCount(1);
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
  await expect(page.locator('#rows .collections__item')).toHaveCount(2);
  // Named after the day and already focused, so typing replaces it.
  await expect(page.locator('#colname')).toBeFocused();

  await page.fill('#colname', 'Beim Essen');
  await expect(page.locator('#rows .collections__name', { hasText: 'Beim Essen' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#rows .collections__name', { hasText: 'Beim Essen' })).toBeVisible();

  await page.click('#rows .collections__item:has-text("Beim Essen")');
  await page.click('#colmore');
  await page.click('.menu button.danger');

  /* The question is a sheet in the page now rather than the browser's own
     confirm, so it is pressed rather than accepted. The destructive button is
     found by its class instead of its words, because this page has two
     languages and the runner picks one. */
  const question = page.locator('dialog[open]');
  await expect(question).toBeVisible();
  await question.locator('.foot button.destructive').click();
  await expect(page.locator('#rows .collections__name', { hasText: 'Beim Essen' })).toHaveCount(0);
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
  await expect(page.locator('#p-data > summary .section')).toHaveText('Wo alles liegt');

  // And each one opens onto the controls it named.
  for (const [panel, marker] of [
    ['p-azure', '#azurekey'], ['p-lang', '#lang'], ['p-data', '#export'],
    // Its own panel since 2026-08-29. The reset was an <h3> at the foot of
    // „Daten", which asked somebody to open a panel about backups to find the
    // one control here that destroys something. A column whose last entry
    // says „Alles löschen" is the honest arrangement, and it is vorlaut's.
    ['p-danger', '#wipe'],
  ] as const) {
    await page.click(`#${panel} > summary`);
    await expect(page.locator(marker)).toBeVisible();
  }
  // The one the compiler could not check: a sentence saying what the picker does.
  await expect(page.locator('[data-i18n="language_hint"]')).not.toBeEmpty();
});

test('opening a panel closes the one open before it', async ({ page }) => {
  await page.click('#gear');
  // Sprache starts open, so a second panel is enough to show the group at work.
  await expect(page.locator('#p-lang')).toHaveJSProperty('open', true);

  await page.click('#p-theme > summary');
  await expect(page.locator('#p-theme')).toHaveJSProperty('open', true);
  // The browser does this, not us: the panels share a name, which makes them
  // one group with radio semantics. Asserting the effect rather than the
  // attribute, so a scripted accordion would keep this green.
  await expect(page.locator('#p-lang')).toHaveJSProperty('open', false);
});

test('the page language is offered the way the scheme beside it is', async ({ page }) => {
  await page.click('#gear');
  // No click: this panel is the one that opens on arrival.
  await expect(page.locator('#p-lang')).toHaveJSProperty('open', true);
  // It was the last native <select>, drawing its own chevron from a hex baked
  // into a data URI — the one control that could not follow the theme. Then a
  // button and a menu, which put the answers behind a press. Now the same
  // segmented group as the scheme in the panel below, because both are facts
  // about this page rather than lists of things to do.
  const group = page.locator('#lang');
  await expect(group).toHaveJSProperty('tagName', 'DIV');
  await expect(group).toHaveAttribute('role', 'group');
  // Every answer on screen, and the one in force marked rather than inferred
  // from a closed control.
  await expect(group.locator('button')).toHaveCount(2);
  await expect(group.locator('button[aria-pressed="true"]')).toHaveText('Deutsch');
  // It fits the sheet it is in: the menu it replaced had to be hung from its
  // own left edge to stop a 190px list on a 90px button reaching back past the
  // sheet's edge, and a control that lays its answers out in a row can fail
  // the same way.
  const [box, sheet] = await Promise.all([
    group.boundingBox(), page.locator('#setup').boundingBox()]);
  expect(box!.x).toBeGreaterThanOrEqual(sheet!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(sheet!.x + sheet!.width);

  await group.getByText('English').click();
  await expect(group.locator('button[aria-pressed="true"]')).toHaveText('English');
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
  // left, and the last words on the right.
  //
  // That right end used to be an „Ändern" button, and the padding inside it had
  // to be subtracted to find where the ink stopped. The line states rather than
  // routes since 2026-08-29, so the last thing in it is a span and its right
  // edge is the ink.
  const ends = await page.evaluate(() => {
    const box = document.querySelector('.compose')!.getBoundingClientRect();
    const kbd = document.querySelector('.chint kbd')!.getBoundingClientRect();
    const last = document.getElementById('voicefrom')!.getBoundingClientRect();
    return { left: Math.round(kbd.left - box.left), right: Math.round(box.right - last.right) };
  });
  expect(ends.left).toBe(0);
  expect(ends.right).toBe(0);

  // And one baseline. This mattered when the right half ended in a padded
  // button and was twice the height of the left: a flex row left to stretch put
  // one at the top of the line and centred the other 7px below it. The button
  // is gone and the two halves are the same height now, so this is holding a
  // fixed thing rather than catching a live one — kept because it is the
  // alignment the row is *for*, and a future control in this line would break
  // it the same way. Measured on the text itself, by range: an element box
  // includes padding and would hide the difference.
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

test('the default voice is named beside the composer and chosen in the settings', async ({ page }) => {
  // Which voice records is a fact the page states, not a control beside every
  // sentence — and it says where the voice comes from and what it speaks.
  await expect(page.locator('#voicename')).not.toBeEmpty();
  await expect(page.locator('#voicefrom')).toContainText('Deutsch');

  /* Through the gear rather than through the composer's „Ändern". That button
     leads to whichever voice the line beside it named, and with one Sammlung
     open that is the Sammlung's — e2e/collection-voice.spec.ts covers the
     routing. This is the default, which is Einstellungen's. */
  await page.click('#gear');
  await expect(page.locator('#setup')).toBeVisible();
  // Sprache is the panel that opens on arrival now, so this one is opened the
  // way a person opens it. See index.html, which says why that panel and not
  // this one.
  await page.locator('#p-voice summary').click();
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
  /* And the line outside follows, because this Sammlung has no voice of its own
     yet and the default is what it falls back to — the same rule voiceFor() in
     db/repo.ts applies when it decides what to record. */
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
  await page.click('#gear');
  // Sprache is the panel that opens on arrival now, so this one is opened the
  // way a person opens it. See index.html, which says why that panel and not
  // this one.
  await page.locator('#p-voice summary').click();
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
  await page.click('#gear');
  // Sprache is the panel that opens on arrival now, so this one is opened the
  // way a person opens it. See index.html, which says why that panel and not
  // this one.
  await page.locator('#p-voice summary').click();
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
  // Already open on arrival, so no click - one would close it.
  await page.locator('#lang').getByText('English').click();
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
  await page.click('#gear');
  await page.locator('#p-voice summary').click();
  await page.fill('#voiceq', 'Thorsten (emotional)');
  await page.locator('#voices .voice').first().click();
  await expect(page.locator('#voicename')).toHaveText('Thorsten (emotional)');
  await page.click('#p-lang > summary');
  await page.locator('#lang').getByText('Deutsch').click();
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

test('which Sammlungen were open comes back, all of them', async ({ page }) => {
  /* conventions.md §1.2. Coming back to the one you were in is the whole of
     what "open" means; and here it is the ones, plural, because arity is many
     (§4.1) and the rail multi-selects for exactly that reason. Restoring one of
     two would be a worse answer than restoring none, because it would look
     like the second Sammlung had been closed.

     It lived in module state before this, so every reload landed on whichever
     Sammlung happened to be first. */
  await page.click('#newcol');
  await page.fill('#colname', 'Beim Essen');
  await expect(page.locator('#rows .collections__name', { hasText: 'Beim Essen' })).toBeVisible();

  const rows = page.locator('#rows .collections__item');
  await expect(rows).toHaveCount(2);

  // One, then the other with the chord that adds rather than replaces.
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
  const open = page.locator('#rows .collections__item[aria-current="true"]');
  await expect(open).toHaveCount(2);

  /* The write is asynchronous and the class changes before it lands, so the
     reload waits for the record rather than for the screen. Without this the
     test reloads between the two writes and restores one Sammlung — which is
     exactly the state it exists to rule out, arrived at for the wrong
     reason. */
  await page.waitForFunction(() => new Promise<boolean>((keep) => {
    const request = indexedDB.open('mitreden');
    request.onerror = () => keep(false);
    request.onsuccess = () => {
      const database = request.result;
      const ask = database.transaction('settings').objectStore('settings').get('settings');
      ask.onsuccess = () => {
        database.close();
        keep(((ask.result as { open?: string[] } | undefined)?.open ?? []).length === 2);
      };
      ask.onerror = () => { database.close(); keep(false); };
    };
  }));

  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);

  // Both, and still both: the set is what was written, not its first member.
  await expect(page.locator('#rows .collections__item')).toHaveCount(2);
  await expect(page.locator('#rows .collections__item[aria-current="true"]')).toHaveCount(2);
});
