import { expect, test } from '@playwright/test';

/**
 * The phone. Only what is genuinely different there: the sidebar is a drawer
 * behind a scrim, and the workhead stacks instead of squeezing three controls
 * onto one line. Everything else is the desktop suite's job.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('the sidebar is a drawer: opens over a scrim, closes by tapping it', async ({ page }) => {
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).not.toBeInViewport();
  await page.click('#sidebaropen');
  await expect(sidebar).toBeInViewport();
  await expect(page.locator('#scrim')).toBeVisible();
  await page.locator('#scrim').click({ position: { x: 350, y: 400 } });
  await expect(sidebar).not.toBeInViewport();
});

test('opening a Sammlung closes the drawer', async ({ page }) => {
  await page.click('#sidebaropen');
  await page.click('#rows .collections__item');
  await expect(page.locator('#sidebar')).not.toBeInViewport();
});

/**
 * The scrim draws no frame, which is the one cost of it becoming a `<button>`.
 *
 * conventions.md §6.3 changed it from a `<div>` on consistency rather than
 * necessity, and named the bill: this product's `.scrim` rule has no `border`
 * declaration, and with `box-sizing: border-box` a bare `<button>` at
 * `inset: 0` takes the user agent's `border: 2px outset ButtonBorder` and draws
 * a two-pixel frame around the whole viewport. The component's scoped style
 * resets it — and the reason this test exists rather than a reading of that
 * file is the sentence beside the reset: no test in any of the three products
 * would have caught it, because the one that exists clicks a position and a
 * position inside a two-pixel border is still inside the scrim.
 *
 * Asserted on the element rather than in the stylesheet, because the question
 * is not whether the declaration is written anywhere. It is whether it wins:
 * the reset is scoped, so it carries the component's hash at 0-2-0, and this
 * page's own `.scrim { z-index: 19 }` is 0-1-0 and sets nothing that competes.
 */
test('the scrim draws no border, now that it is a button', async ({ page }) => {
  await page.click('#sidebaropen');
  const scrim = page.locator('#scrim');
  await expect(scrim).toBeVisible();
  for (const side of ['border-top-width', 'border-right-width',
    'border-bottom-width', 'border-left-width']) {
    await expect(scrim, `${side} on a control the size of the window`).toHaveCSS(side, '0px');
  }
});

/* And a keyboard can reach it, which is what the change bought. The drawer's ✕
   is still the first thing in there and still the obvious way out; this is the
   second one, and it used to be a div that nothing could focus. */
test('the scrim is reachable and closes the drawer', async ({ page }) => {
  await page.click('#sidebaropen');
  await expect(page.locator('#sidebar')).toBeInViewport();
  await page.locator('#scrim').focus();
  await expect(page.locator('#scrim')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sidebar')).not.toBeInViewport();
});

/* What the ☰ says about the thing it opens. None of the three products had
   this before the component: the bar's control named nothing and announced no
   state, so a reader was told there was a button and not what pressing it
   would do. */
test('the ☰ names the drawer and says whether it is up', async ({ page }) => {
  const bar = page.locator('#sidebaropen');
  await expect(bar).toHaveAttribute('aria-controls', 'sidebar');
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
  await bar.click();
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
  // And the drawer carries the ✕ down here, which is the only head on screen
  // while the layer covers the bar.
  await expect(page.locator('#sidebarclose')).toBeVisible();
});

/**
 * Escape, which is the third way out and the one this product did not have.
 *
 * conventions.md §6.3 promised four things the component adds that no product
 * had: `aria-expanded`/`aria-controls`, Escape, focus moving in, and focus
 * coming back. The first build shipped only the ARIA — which is markup — and
 * neither of the two that needed code. The adoption commit found that and
 * declined to write a mitreden-local Escape handler, because a copy in one of
 * three products is exactly the divergence the extraction exists to end. The
 * behaviour arrives from the package instead, at v1.38.0, and these two tests
 * are it arriving here.
 *
 * Pressed twice from two places, because the listener is on the window rather
 * than on the `<aside>` and that is the whole of its point. The first press is
 * from where the component has just put focus; the second is from the scrim,
 * which is a sibling of the column and not inside it — a listener attached to
 * the drawer would answer the first and be deaf to the second, and the drawer
 * would stay up for anybody who had tabbed out of it.
 */
test('Escape closes the drawer, from inside it and from the scrim', async ({ page }) => {
  const sidebar = page.locator('#sidebar');
  await page.click('#sidebaropen');
  await expect(sidebar).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toBeInViewport();

  await page.click('#sidebaropen');
  await expect(sidebar).toBeInViewport();
  await page.locator('#scrim').focus();
  await page.keyboard.press('Escape');
  await expect(sidebar, 'a press that arrives from outside the column').not.toBeInViewport();
});

/**
 * The round trip: focus goes into the layer when it opens and comes back out to
 * whatever opened it when it closes.
 *
 * The `✕` rather than the first Sammlung, which is the component's choice and
 * the right one — it is the way out, which is what somebody who has just been
 * handed a layer over their work needs to be able to find, and Tab from there
 * reaches the list in one press.
 *
 * Both ways out are asked, because they leave focus in different places at the
 * moment the drawer goes: Escape leaves it on the `✕`, and pressing the `✕`
 * leaves it on a button that is about to stop being drawn. Without the restore
 * both land focus on `<body>`, which sends a keyboard back to the top of the
 * page — the same defect menu.spec.ts closed for the menu, and the reason that
 * file's last two tests read the way they do.
 */
test('the drawer takes focus when it opens and hands it back when it closes', async ({ page }) => {
  const bar = page.locator('#sidebaropen');
  const close = page.locator('#sidebarclose');

  await bar.click();
  await expect(close, 'the way out is what focus lands on').toBeFocused();
  await page.keyboard.press('Escape');
  await expect(bar, 'and it comes back to the ☰ that opened it').toBeFocused();

  // And by the ✕, which removes itself in the same beat it dismisses the layer.
  await bar.click();
  await expect(close).toBeFocused();
  await close.click();
  await expect(page.locator('#sidebar')).not.toBeInViewport();
  await expect(bar).toBeFocused();
});

test('nothing overflows the screen', async ({ page }) => {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBe(0);
});

test('a sidebar put away on a laptop still opens as a drawer here', async ({ page }) => {
  // The choice is remembered, and it is a desktop choice: there is no control
  // on this width to undo it, so it must not follow the user onto the phone.
  //
  // Put away through the control, at the width the control exists at, rather
  // than by seeding the store. This used to write localStorage directly, and
  // when the preference moved into the settings record (§1.3) that line stopped
  // reaching anything — the test would have stayed green while asserting
  // nothing, because on a phone the sidebar is off-canvas either way.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('#sidebarhide');
  await expect(page.locator('#sidebarshow')).toBeVisible();

  // The write is asynchronous, so the reload has to come after it lands rather
  // than after the class changes. Asked of the database, which is the thing
  // being relied on.
  await page.waitForFunction(() => new Promise<boolean>((keep) => {
    const request = indexedDB.open('mitreden');
    request.onerror = () => keep(false);
    request.onsuccess = () => {
      const database = request.result;
      const ask = database.transaction('settings').objectStore('settings').get('settings');
      ask.onsuccess = () => {
        database.close();
        keep((ask.result as { sidebarOpen?: boolean } | undefined)?.sidebarOpen === false);
      };
      ask.onerror = () => { database.close(); keep(false); };
    };
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).not.toBeInViewport();
  await page.click('#sidebaropen');
  await expect(sidebar).toBeInViewport();
});
