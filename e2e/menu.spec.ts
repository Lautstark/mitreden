import { expect, test } from '@playwright/test';

/*
 * That an open menu can be reached without a mouse.
 *
 * The menu has always drawn correctly and has always worked under a pointer.
 * What it lacked was every part of the menu button pattern that is not
 * drawing: the popup carried no role, its items carried none either, and
 * opening one left focus sitting on the trigger — so a reader was told the
 * list had expanded and then had nothing to read, and a keyboard had no way
 * into it at all.
 *
 * It is worth its own file because of how it got that way. vorlaut forked this
 * exact function, fixed the roles and the focus there, and the fix never came
 * back — two products, one function, and the accessible one was not this one.
 * Nothing in either suite went red for that, which is the gap these close.
 *
 * The other half is the third argument. It was a positional boolean meaning
 * "destructive" here and "in force" in vorlaut, so the same call announced
 * opposite things depending on which repository it was in. It is a named field
 * now, and the last test is what holds the two meanings apart.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('a menu says what it is, and so do its items', async ({ page }) => {
  const trigger = page.locator('#colmore');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.menu')).toHaveAttribute('role', 'menu');

  // Commands, not alternatives: nothing here is "in force", so nothing claims
  // to be checked.
  const items = page.locator('.menu button');
  await expect(items.first()).toHaveAttribute('role', 'menuitem');
  await expect(page.locator('.menu button[aria-checked]')).toHaveCount(0);
  // A button inside whatever the page happens to be, so it must not submit it.
  await expect(items.first()).toHaveAttribute('type', 'button');
});

test('opening a menu puts focus in it', async ({ page }) => {
  await page.click('#colmore');
  // The whole defect, in one assertion: focus on the trigger means the menu is
  // open only in the drawing.
  await expect(page.locator('.menu button').first()).toBeFocused();
});

test('the arrows and Home/End walk the list', async ({ page }) => {
  await page.click('#colmore');
  const items = page.locator('.menu button');
  const count = await items.count();
  expect(count).toBeGreaterThan(1);

  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(0)).toBeFocused();
  // Round, rather than stopping: a menu this short is faster to leave by the
  // top than to walk back down.
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(count - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(count - 1)).toBeFocused();
});

test('Escape closes the menu and hands focus back', async ({ page }) => {
  const trigger = page.locator('#colmore');
  await trigger.click();
  await page.keyboard.press('Escape');

  await expect(page.locator('.menu')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // Focus has to land somewhere it can be found again. Dropping it on <body>
  // sends a keyboard user back to the top of the page.
  await expect(trigger).toBeFocused();
});

test('a click elsewhere closes the menu without stealing focus', async ({ page }) => {
  await page.click('#colmore');
  // The other side of the rule above: this close is not keyboard-driven, and
  // pulling focus back to the trigger would take it out of the field the click
  // just landed in.
  await page.click('#t');
  await expect(page.locator('.menu')).toHaveCount(0);
  await expect(page.locator('#t')).toBeFocused();
});

/* Two tests stood here and are gone rather than moved, which is worth saying.
 *
 * They asked whether a menu that is a *choice* marks the answer in force -
 * exactly one aria-checked, and a colour that says so to somebody not using a
 * reader. The language menu was their subject, and it is a segmented group now
 * (see app.spec.ts), which left this page with no choice-menu at all: every
 * remaining menu here is a list of things to do.
 *
 * Rewriting them against #colmore would have asserted a property that menu does
 * not have and never did. So: the aria-checked half is held by the component's
 * own suite, design/tests/menu.test.js, which is where a question about the
 * shared function belongs. The visual half is CSS out of the same shared
 * components.css, and vorlaut still asks it of the Sammlung's language picker,
 * which stays a menu. Nothing about the shared menu went unguarded; the guard
 * moved to where the thing it guards actually lives. */

