import { expect, test } from '@playwright/test';

/**
 * What the settings sheet looks like, kept as pictures.
 *
 * Every other file in here asks whether something *works*. This one asks
 * whether anything *moved*, and it exists for one reason: the CSS behind these
 * panels is on its way out of this repository and into @lautstark/design, where
 * three products will share it. That move is meant to be invisible — the same
 * page, drawn by a stylesheet somebody else ships — and "meant to be" is not a
 * thing a suite of selectors can check. `#export` is visible before the move and
 * visible after it whether or not the button changed size, colour, or which
 * paragraph it sits under.
 *
 * So the pictures are taken now, before anything moves, and committed. They are
 * not a description of how the sheet ought to look; they are a record of how it
 * did look on the last commit where the CSS was still ours. A diff afterwards is
 * either a change somebody meant to make — in which case the picture is updated
 * in the same commit, and the diff is the evidence in the review — or it is the
 * move having quietly taken something with it.
 *
 * ## The three shots, and why the middle one is the one that matters
 *
 * The „Wo alles liegt" panel is the only place in this product where two panels
 * drawn by *another* repository sit side by side in ours:
 * @lautstark/sicherung/ablage-panel and @lautstark/sicherung/backup-panel. They
 * bring their own markup and their own class names — `.where-panel`, `.tree`,
 * `.backup-panel`, `.standing`, `.dot` — and not one line of the CSS that makes
 * them look like part of this page. That CSS is ours today and is exactly what
 * is being moved. Nothing in the package's own suite can see this: over there
 * the panels are drawn against the package's test page. Here they are drawn
 * against ours, and here is where a token that stopped resolving shows up.
 *
 * ## Panels, not the page
 *
 * Each shot is of an element, not of the viewport. A screenshot of the whole
 * page would carry the rail with it, and the rail holds a Sammlung named after
 * today's date — a baseline that goes red at midnight is a baseline nobody
 * keeps. The dialog is a modal `<dialog>`, so its own box is the sheet and
 * nothing behind it.
 *
 * ## Why these do not run on CI
 *
 * Playwright names a snapshot after the platform it was taken on, because a
 * platform is what draws it: macOS and Linux disagree about text rasterisation
 * on nearly every glyph, and no threshold that tolerates that would still catch
 * a 1px padding change. Only the darwin baselines are committed, so on the
 * ubuntu runner these would fail as *missing*, which says nothing about the CSS
 * and turns the deploy gate red for a reason nobody can act on. They are
 * therefore skipped anywhere else, and the skip is loud rather than a filter in
 * the config: somebody reading a green CI run should be able to find out from
 * this file that the pictures were not part of it.
 *
 * The comparison this file exists for is a local one anyway — the same machine,
 * before the move and after it — which is the only comparison where a pixel
 * diff means what it says.
 */

/* Deterministic, and not devices['Desktop Chrome']'s 1280×720.
 *
 * Not because 720 is wrong, but because it is the same number the rest of the
 * suite runs at and would silently become part of these pictures: a viewport
 * changed for some unrelated reason in playwright.config.ts would re-flow every
 * panel here and read as a regression in the CSS. Written down where the
 * pictures are, so it moves only when somebody moves it on purpose. The extra
 * height is so the sheet is not scrolled when it is measured. */
test.use({ viewport: { width: 1280, height: 900 } });

/**
 * What is painted over, and why each one.
 *
 * A mask is a loss — the pink rectangle is a piece of the page this file stops
 * checking — so it is spent only on the parts that carry a *value* rather than
 * a design:
 *
 *   - The three headings that state themselves. Two of them are answered from
 *     the database a frame or two after the sheet opens (see app.spec.ts, which
 *     is about exactly that), and „Noch keine Sätze" becomes „1 Satz" the moment
 *     anybody types. The wait below settles them; the mask is what stops the
 *     settled value from becoming part of the baseline.
 *   - The backup panel's status line, which is a clock. It says „gesichert vor 3
 *     Minuten" in front of a chosen folder, and „vor 3 Minuten" is a different
 *     picture every three minutes. A runner cannot reach that state — the folder
 *     picker needs a real gesture and a real folder — so today the line reads a
 *     fixed sentence about there being no folder yet. The mask is not for today:
 *     it is so that the first person who runs this against a browser profile
 *     that *has* a folder does not find a red suite and a diff made of minutes.
 *
 * The bars are wider than the words, and that is not sloppiness: `.state` is a
 * flex child that takes the rest of the summary row, so the box a mask is given
 * is the same box whatever the heading says. A mask covers a box, not a string
 * — painting over an element whose width follows its text would let the text go
 * on changing the picture through the shape of its own mask. Which is also why
 * the status line is masked by its sentence span and not by the whole `<p>`:
 * the span is the words, and the `.dot` beside it is the one mark in either
 * package panel whose colour *is* the state. Losing that to a rectangle would
 * give away the thing most worth watching — @lautstark/design conventions.md
 * §3.7 is about precisely that dot being drawn in the wrong grey.
 *
 * Everything else in both package panels is left bare on purpose. The folder
 * name, the one other thing that varies, appears only in states that come with
 * a folder, and every line that can hold one is either masked above or absent
 * until then — so nothing is bought by painting over the sentences, and the
 * rule under „Herausnehmen und einlesen", the notice box and the tree drawing
 * are precisely what is being watched.
 */
const varies = (page: import('@playwright/test').Page) => [
  page.locator('#voicestate'),
  page.locator('#azurestate'),
  page.locator('#datastate'),
  page.locator('.backup-panel p.standing span:not(.dot)'),
];

/**
 * The sheet, open and settled.
 *
 * „Settled" is the whole of the setup. Two of the headings answer late — the
 * Azure one from the database, which is why openSetup() writes „Wird geladen …"
 * into it rather than leaving it blank, and the voice one from a list fetched at
 * start-up — and a picture taken in between holds the interim answer. That
 * answer is a real state and correctly drawn, and it would make this file go red
 * whenever the machine is a little slower than it was on the day the baseline
 * was taken. Waited for rather than masked-and-hoped: a mask hides the words, it
 * does not hide a line that is one line taller.
 */
async function openSetup(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
  await page.click('#gear');
  await expect(page.locator('#setup')).toBeVisible();
  // The key is read from the database, so this is the last heading to answer.
  await expect(page.locator('#azurestate')).toHaveText('Kein Schlüssel');
  // And the voice list is fetched at start-up: „Keine Stimme" until it lands,
  // then a name, a source and a language, separated by dots.
  await expect(page.locator('#voicestate')).toContainText('·');
}

/* German, like the rest of the suite.
 *
 * There is no test.use({ locale }) to follow: this page does not read the
 * browser's language, it reads `?lang=` and its own stored answer, and every
 * spec here says `/?lang=de` in so many words. One of them — working.spec.ts —
 * says `en` because it is checking English sentences, which is the exception
 * that shows what the rule is for. German is what the product opens in and what
 * these pictures are of. If the English sheet is ever worth a baseline it is a
 * second set of files, not a second guess about which one is in the first. */

test.beforeEach(async () => {
  test.skip(process.platform !== 'darwin',
    'Screenshot baselines are committed for darwin only — see the note at the top of this file.');
});

test('the settings sheet, whole', async ({ page }) => {
  await openSetup(page);
  // Panels folded as they arrive, with only „Sprache" open — which is a
  // decision index.html argues for at length, and therefore a thing worth
  // having a picture of.
  await expect(page.locator('#setup')).toHaveScreenshot('einstellungen.png', { mask: varies(page) });
});

test('the „Wo alles liegt" panel, with both package panels in it', async ({ page }) => {
  await openSetup(page);
  await page.click('#p-data > summary');
  // The two panels from @lautstark/sicherung, and this product's own row of
  // buttons under them. All three have to be there before the picture: the
  // panels are appended at wiring time and the summary only unfolds them, but
  // asserting it here is what makes a future null from backupPanel() a failure
  // rather than a quietly different baseline.
  await expect(page.locator('#wherebox .where-panel')).toBeVisible();
  await expect(page.locator('#folderbox .backup-panel')).toBeVisible();
  await expect(page.locator('#export')).toBeVisible();
  await expect(page.locator('#p-data')).toHaveScreenshot('wo-alles-liegt.png', { mask: varies(page) });
});

test('the „Alles löschen" panel', async ({ page }) => {
  await openSetup(page);
  await page.click('#p-danger > summary');
  // The only control in this product that destroys something, and the only
  // .btn.destructive in the sheet. What its colour is made of is a token, and a
  // token that stops resolving is grey rather than absent — which is the one
  // regression here that no assertion about text or visibility would catch.
  await expect(page.locator('#wipe')).toBeVisible();
  await expect(page.locator('#p-danger')).toHaveScreenshot('alles-loeschen.png', { mask: varies(page) });
});
