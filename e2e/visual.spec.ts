import { expect, test } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
 * ## The four shots, and why two of them are the ones that matter
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
 * „Standardstimme" is the second, and it was added on 2026-09-03 by the move it
 * watches. The whole voice picker became
 * @lautstark/stimmquelle/voice-picker and every `.voice*` rule left
 * src/styles/app.css for components.css — and the three shots that existed
 * then came back byte-identical, because that panel is folded in the sheet
 * shot and no picture had ever held a row of it. Byte-identical is what a
 * clean move looks like and it is also what no comparison at all looks like,
 * which is why the shot below opens the panel first. See the note on the test
 * itself.
 *
 * ## Panels, not the page
 *
 * Each shot is of an element, not of the viewport. A screenshot of the whole
 * page would carry the rail with it, and the rail holds a Sammlung named after
 * today's date — a baseline that goes red at midnight is a baseline nobody
 * keeps. The dialog is a modal `<dialog>`, so its own box is the sheet and
 * nothing behind it.
 *
 * ## One set of pictures per platform, and what decides whether they run
 *
 * Playwright names a snapshot after the platform it was taken on, because a
 * platform is what draws it: macOS and Linux disagree about text rasterisation
 * on nearly every glyph, and no threshold that tolerates that would still catch
 * a 1px padding change. So `einstellungen-desktop-darwin.png` and
 * `einstellungen-desktop-linux.png` are two pictures of the same panel, and
 * neither is the other's baseline.
 *
 * For a while only the darwin files were committed, and this file dealt with
 * that by refusing to run anywhere else — `test.skip(process.platform !==
 * 'darwin', …)`, one platform written in by hand. That skip was right about the
 * problem: a missing baseline is not a regression, and a check that goes red on
 * the runner for a reason nobody can act on is a check people learn to ignore.
 * It was wrong about where the answer lives. It hard-wired *which* platform has
 * pictures into the one file that has no way of knowing, so the day a Linux
 * baseline arrived the comparison would still not have run, and nothing would
 * have said so.
 *
 * The guard below asks the snapshot directory instead: is there a file here
 * ending in `-{platform}.png`? Where there is, the comparison runs. Where there
 * is not, the tests skip and name the platform that has no picture. That makes
 * committing the PNGs the whole of the switch — no list here to extend, and
 * nothing to remember to flip back.
 *
 * The one case where the directory must not have the last word is a run that is
 * there to *write* it: under `--update-snapshots` a platform with no baseline
 * would otherwise skip itself out of ever getting one. Hence the
 * `updateSnapshots` check — 'all' and 'changed' are the modes that write, and a
 * run in either of them is never skipped.
 *
 * To give a platform baselines of its own, run the suite there once with
 * `npx playwright test e2e/visual.spec.ts --update-snapshots` and commit what
 * it writes. The Linux set cannot be recorded on an Apple Silicon machine — the
 * matching `mcr.microsoft.com/playwright` image is amd64 and dies under QEMU,
 * and an arm64 image would draw pixels nobody could prove match the runner — so
 * .github/workflows/baselines.yml records them on the runner itself and hands
 * them back as an artifact. The note at the top of that file is the rest of
 * this one.
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

/* Where the pictures are, resolved from this file rather than from the working
 * directory: Playwright is run from the repository root by `npm run test:e2e`
 * and from wherever a person happens to be standing by everything else, and a
 * guard that answers differently depending on that is worse than no guard. */
const SNAPSHOTS = fileURLToPath(new URL('./visual.spec.ts-snapshots', import.meta.url));

/** Whether any baseline in that directory was recorded on the platform now running. */
function recordedHere(): boolean {
  if (!existsSync(SNAPSHOTS)) return false;
  return readdirSync(SNAPSHOTS).some((name) => name.endsWith(`-${process.platform}.png`));
}

test.beforeEach(async ({}, testInfo) => {
  /* 'missing' and 'none' are the modes that only ever compare; 'all' and
     'changed' are the ones that write, and a run that is here to write must not
     skip itself out of ever producing a first baseline. */
  const recording = testInfo.config.updateSnapshots === 'all'
    || testInfo.config.updateSnapshots === 'changed';
  test.skip(!recording && !recordedHere(),
    `No baseline recorded for ${process.platform} — see the note at the top of this file.`);
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

test('the „Standardstimme" panel, with the picker the package draws', async ({ page }) => {
  await openSetup(page);
  /* This panel had no picture at all until 2026-09-03, and the way that came
     out is worth writing down. The picker moved to
     @lautstark/stimmquelle/voice-picker and its CSS to components.css — every
     `.voice*` rule left this repository, the markup gained a `.voices__row`
     wrapper around every row, and the nested 340px scroller went. Then all
     three baselines above passed byte-identical. Not because the move was
     clean: because the panel is folded in the shot that would have held it, so
     no picture had ever contained a single row of it. A green suite for a
     comparison that never took place is the exact failure the note at the top
     of this file describes, one floor down.

     So the panel is opened, the way app.spec.ts opens it, and this is the
     picture. What it is watching is what only a picture can see: that the
     block a package now draws still sits in this page's panel like the rest of
     it. The rows carry no `.small` or `.muted` — the module emits neither, on
     purpose — so the 12px faint facts line under each name is components.css's
     `.voice__facts` and nothing else, and it goes grey-on-grey or 13.5px the
     moment a token or a rule stops reaching it. */
  await page.locator('#p-voice summary').click();
  await expect(page.locator('#p-voice')).toHaveAttribute('open', '');
  /* And the pointer taken off the panel, which is not fussiness. The panels are
     one exclusive group (`<details name="settings">`), so opening this one
     folds „Sprache" above it and the whole panel slides up under a mouse that
     is still parked where the summary used to be — which landed it on the
     second row and baked that row's :hover into the first baseline recorded
     here. It would have been stable, and it would have been a picture of a
     hover state nobody chose, hiding what that row actually looks like. */
  await page.mouse.move(0, 0);
  /* Settled before it is measured, for openSetup's reason and one more of its
     own: the rows come from the catalogue fetched at start-up, and a picture
     taken with none of them is a picture of an empty list that would go on
     passing. Asserting a checked row is what makes it the *settled* list —
     `current()` has an answer, so the accent tint is in the shot. */
  await expect(page.locator('#voices .voice[aria-checked="true"]')).toBeVisible();
  /* And the list is not a scroll box. The module took the nested scroller out
     — a wheel gesture latches to the list and the sheet under it stops moving
     — which is a change no picture can state, because "not clipped" and "short
     enough not to be" look the same. The panel is 700px of unclipped list in
     the shot below, so this says out loud what the picture only implies. */
  await expect(page.locator('#voices .voices')).toHaveCSS('max-height', 'none');
  await expect(page.locator('#p-voice')).toHaveScreenshot('standardstimme.png', { mask: varies(page) });
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
