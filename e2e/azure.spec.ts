import { expect, test } from '@playwright/test';

/**
 * The Azure key, without an Azure key.
 *
 * Every answer the endpoint can give is stubbed, because the thing that was
 * broken was never Azure: it was that the page said nothing at all while the
 * check ran, and then said nothing useful when it failed. That is testable
 * without a subscription, and the real request is one call in stimmquelle.
 */

const VOICES = [
  { Name: 'Microsoft Server Speech Text to Speech Voice (de-DE, KatjaNeural)',
    ShortName: 'de-DE-KatjaNeural', DisplayName: 'Katja', LocalName: 'Katja',
    Locale: 'de-DE', Gender: 'Female', VoiceType: 'Neural', Status: 'GA' },
  { Name: 'Microsoft Server Speech Text to Speech Voice (de-DE, ConradNeural)',
    ShortName: 'de-DE-ConradNeural', DisplayName: 'Conrad', LocalName: 'Conrad',
    Locale: 'de-DE', Gender: 'Male', VoiceType: 'Neural', Status: 'GA' },
];

/**
 * The region rides in the subdomain — westeurope.tts.speech.microsoft.com —
 * so a glob that names the host, `**` + `/tts.speech...`, matches nothing:
 * the character before `tts` is a dot, not a slash. A test whose route does
 * not match talks to the real Microsoft, and a real 401 reads like a pass of
 * the wrong test. The regex has no opinion about where the host begins.
 */
const VOICE_LIST = /tts\.speech\.microsoft\.com\/cognitiveservices\/voices\/list/;

async function openVoices(page: import('@playwright/test').Page) {
  await page.goto('/?lang=de');
  await reopenVoices(page);
}

/**
 * The picker is drawn when the dialog opens, not kept in the page. It used to
 * be a <select> beside the composer, which meant a reload was enough to assert
 * against it; the voices live in the settings now, so a reload has to be
 * followed back in. The Azure panel is folded, so it is opened too.
 */
async function reopenVoices(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);
  await page.click('#gear');
  await page.click('#p-azure > summary');
}

const voice = (page: import('@playwright/test').Page, name: string) =>
  page.locator('#voices .voice__name', { hasText: name });

test('a key Azure refuses says which of the two things is wrong', async ({ page }) => {
  await page.route(VOICE_LIST, (route) =>
    route.fulfill({ status: 401, body: '' }));
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.fill('#azureregion', 'westeurope');
  await page.click('#cloud .save');
  // The region is the usual culprit and the message has to say so, in German.
  await expect(page.locator('#s')).toContainText('Region', { timeout: 10_000 });
});

test('the button says it is working while it waits', async ({ page }) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(VOICE_LIST, async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) });
  });
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.click('#cloud .save');
  // This is the bug that read as "nothing happens".
  await expect(page.locator('#cloud .save')).toBeDisabled();
  await expect(page.locator('#cloud .save')).toHaveText(/prüft/i);
  release?.();
});

test('a key Azure accepts is kept, and its voices join the picker', async ({ page }) => {
  await page.route(VOICE_LIST, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) }));
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.fill('#azureregion', 'westeurope');
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });
  await expect(voice(page, 'Katja')).toHaveCount(1);
  // The picker says where each voice comes from, which is the difference
  // between a voice on this machine and a request to Microsoft per sentence.
  await expect(page.locator('#voices .voice', { hasText: 'Katja' })).toContainText('Azure');
  // And it is still there after a reload, or it was never really saved.
  await page.reload();
  await reopenVoices(page);
  await expect(voice(page, 'Katja')).toHaveCount(1);
});

test('opening the settings answers whether Azure does, and asks it only once', async ({ page }) => {
  let asks = 0;
  await page.route(VOICE_LIST, (route) => {
    asks += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) });
  });
  await openVoices(page);
  await page.fill('#azurekey', 'A'.repeat(28) + 'Nk7q');
  await page.click('#cloud .save');
  // The save's answer lands on the still-open dialog: which key, and that
  // Azure answers it with a count.
  await expect(page.locator('#setup')).toHaveJSProperty('open', true);
  await expect(page.locator('#azurestate')).toContainText('Nk7q');
  // The field shows the held key as a placeholder, not a value: nothing to
  // reveal, nothing to resubmit, and an untouched field visibly keeps it.
  await expect(page.locator('#azurekey')).toHaveAttribute('placeholder', /Nk7q/);
  await expect(page.locator('#azurekey')).toHaveValue('');
  await expect(page.locator('#cloud .probe')).toHaveText('2 Stimmen verfügbar');
  expect(asks).toBe(1);
  // A fresh visit probes on open — and still asks once, although the voice
  // picker wants the same catalogue.
  await page.reload();
  await reopenVoices(page);
  await expect(page.locator('#cloud .probe')).toHaveText('2 Stimmen verfügbar');
  expect(asks).toBe(2);
});

test('a stored key whose region stops answering says so, and the shipped voices survive', async ({ page }) => {
  await page.route(VOICE_LIST, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) }));
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });
  // The hostname carries the region, and a region that stops resolving fails
  // before any status exists.
  await page.unroute(VOICE_LIST);
  await page.route(VOICE_LIST, (route) => route.abort('namenotresolved'));
  await page.reload();
  await reopenVoices(page);
  await expect(page.locator('#cloud .probe')).toContainText('antwortet nicht');
  // Broken Azure costs its own rows alone: the shipped voices are still there.
  await expect(page.locator('#voices .voice[data-id^="piper:"]')).not.toHaveCount(0);
  await expect(voice(page, 'Katja')).toHaveCount(0);
});

test('a stored key Azure has stopped taking gets its words on the card', async ({ page }) => {
  await page.route(VOICE_LIST, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) }));
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });
  // Valid when it was stored, revoked by the next visit.
  await page.unroute(VOICE_LIST);
  await page.route(VOICE_LIST, (route) => route.fulfill({ status: 401, body: '' }));
  await page.reload();
  await reopenVoices(page);
  await expect(page.locator('#cloud .probe')).toContainText('lehnt den Schlüssel ab');
});

test('a region name that is not one is a sentence at save time, not a silence', async ({ page }) => {
  await page.route(VOICE_LIST, (route) => route.abort('namenotresolved'));
  await openVoices(page);
  await page.fill('#azurekey', '0'.repeat(32));
  await page.fill('#azureregion', 'westeurop');
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('antwortet nicht', { timeout: 10_000 });
  // And the key was not stored: a pairing that never answered is not one to keep.
  // The heading says so rather than falling silent — an empty state is exactly
  // what a panel that carries its status must never show.
  await expect(page.locator('#azurestate')).toHaveText('Kein Schlüssel');
});

test('a save that only moves the region keeps the key it already has', async ({ page }) => {
  await page.route(VOICE_LIST, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOICES) }));
  await openVoices(page);
  await page.fill('#azurekey', 'A'.repeat(28) + 'Nk7q');
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });
  // The redraw left the key field empty again — the trap was that saving now
  // meant forgetting. Only the region moves; the status line is cleared first
  // so the next 'freigeschaltet' is provably this save's.
  await page.evaluate(() => { document.getElementById('s')!.textContent = ''; });
  await page.fill('#azureregion', 'northeurope');
  await page.click('#cloud .save');
  await expect(page.locator('#s')).toContainText('freigeschaltet', { timeout: 10_000 });
  await page.reload();
  await reopenVoices(page);
  await expect(page.locator('#azurestate')).toContainText('Nk7q');
  await expect(page.locator('#azureregion')).toHaveValue('northeurope');
});
