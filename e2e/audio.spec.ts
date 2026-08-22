import { expect, test } from '@playwright/test';

/**
 * That mitreden records at all, and stores something a device can play.
 *
 * Deliberately not a loudness test. Trim, measurement and levelling are
 * stimmquelle's contract and are checked there against ffmpeg; re-testing them
 * here would be asserting a dependency's behaviour from the outside, and the
 * first attempt did exactly that — it failed a recording at -17.66 LUFS while
 * the pipeline this replaced produced -16.1 to -18.4 for the same kind of
 * sentence. The tolerance was invented, not measured.
 *
 * What is mitreden's own is above and below the package: that a sentence
 * reaches it, and that what comes back is stored as a playable mp3.
 *
 * It downloads a 60 MB voice the first time, so it is slow on purpose.
 */
test('a sentence typed in becomes a playable mp3', async ({ page }) => {
  test.slow();
  test.setTimeout(5 * 60_000);

  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);
  await page.fill('#t', 'Ich will noch nicht ins Bett.');
  await page.click('#add');

  // The row appears at once and gains audio when the voice exists.
  await expect(page.locator('.item')).toHaveCount(1);
  await page.waitForFunction(() => document.querySelector('.item.ok audio') !== null,
    null, { timeout: 4 * 60_000 });

  const stored = await page.evaluate(async () => {
    const request = indexedDB.open('mitreden');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const blob = await new Promise<Blob>((resolve, reject) => {
      const all = database.transaction('audio', 'readonly').objectStore('audio').getAll();
      all.onsuccess = () => resolve(all.result[0] as Blob);
      all.onerror = () => reject(all.error);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    await ctx.close();
    return { magic: [...bytes.slice(0, 3)], bytes: bytes.length, seconds: decoded.duration };
  });

  // An ID3 tag or a bare frame header. Anything else is not an mp3, whatever
  // the extension on the file a device ends up with says.
  const [b0, b1] = stored.magic as [number, number, number];
  const isMp3 = stored.magic.join() === [0x49, 0x44, 0x33].join()
    || (b0 === 0xFF && (b1 & 0xE0) === 0xE0);
  expect(isMp3, `starts ${stored.magic}`).toBe(true);
  expect(stored.bytes).toBeGreaterThan(1000);
  expect(stored.seconds).toBeGreaterThan(0.5);
});
