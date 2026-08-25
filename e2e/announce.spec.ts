import { expect, test } from '@playwright/test';

/*
 * That what the page reports is reported out loud.
 *
 * The status line has always been on screen and has always been correct; what
 * it lacked was a role, and it was toggled with [hidden] besides — so it left
 * the accessibility tree between messages and re-entered it carrying the text,
 * which is the one arrangement under which a live region announces nothing. An
 * import that added forty sentences, a saved Azure key and every error this
 * page can report were all silent.
 *
 * None of that is visible in a screenshot, and no other test in this suite
 * would have gone red for it, which is why it gets its own file. These check
 * the two properties a live region actually needs: that it is in the tree
 * before the text arrives, and that it is still there afterwards.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);
});

test('the status line is a live region before it has anything to say', async ({ page }) => {
  const line = page.locator('#s');
  await expect(line).toHaveAttribute('role', 'status');
  // Empty, but present: a region added at the moment of the message is a region
  // the reader was not watching.
  await expect(line).toHaveText('');
  await expect(line).not.toHaveAttribute('hidden', /.*/);
  expect(await line.evaluate((node) => getComputedStyle(node).display)).not.toBe('none');
});

test('an empty status line takes no room', async ({ page }) => {
  // The reason it may stay in the tree rather than being hidden: it costs
  // nothing on screen while it is empty.
  expect(await page.locator('#s').evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
});

test('a reported result lands in the live region and stays there', async ({ page }) => {
  await page.fill('#t', 'Ich möchte noch nicht schlafen.');
  await page.click('#add');

  const line = page.locator('#s');
  await expect(line).not.toHaveText('');
  // Still the same element, still a live region: replacing the node instead of
  // its text is the other way to lose the announcement.
  await expect(line).toHaveAttribute('role', 'status');
  expect(await line.evaluate((node) => getComputedStyle(node).display)).not.toBe('none');
});

test('the Azure probe line is a region that is never hidden', async ({ page }) => {
  /* A second live region, and a legitimate one: it reports inside a modal, and
     the page's own status line is inert behind that modal while it is open
     (§3.8). What it must not do is what it used to — `probe.hidden = !azure`,
     so with no key stored the region left the accessibility tree and came back
     carrying its next message.

     No key is stored here, which is exactly the state that used to hide it. */
  await page.click('#gear');
  const panel = page.locator('#p-azure');
  if ((await panel.getAttribute('open')) === null) await panel.locator('summary').click();

  const probe = page.locator('.probe');
  await expect(probe).toHaveAttribute('role', 'status');
  await expect(probe).not.toHaveAttribute('hidden', /.*/);
  await expect(probe).toBeEmpty();
  // Empty it costs nothing, which is what lets it stay rather than being hidden.
  expect(await probe.evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
  expect(await probe.evaluate((node) => getComputedStyle(node).marginTop)).toBe('0px');
});
