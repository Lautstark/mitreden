import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT, exportEverything, importBackup, isBackup, stripSecrets,
} from '../../src/db/backup.ts';
import {
  loadCollections, loadPhrases, saveCollections, savePhrases, saveSettings, wipe,
} from '../../src/db/db.ts';

/**
 * What may reach a folder that is very likely inside Dropbox.
 *
 * Choosing a folder is choosing to have a sync client carry the file off the
 * machine — to somebody's cloud, then to every device sharing the folder. So
 * this file is about two things: that the credential never makes the trip, and
 * that a library which does make it comes back whole.
 */
describe('the Azure key', () => {
  beforeEach(() => wipe());

  /*
   * The wiring, asserted against the source. A behavioural test cannot catch
   * the failure that matters: if somebody hands Sicherung the raw settings —
   * or anything other than the audited export — every other test still passes
   * and the backup keeps working. It would simply also be uploading a paid
   * credential. So the constructor call itself is under test.
   */
  it('is constructed with exportEverything and nothing else', () => {
    const source = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    const calls = [...source.matchAll(/new Sicherung\(([^)]*)\)/g)].map((m) => m[1]);

    expect(calls, 'expected exactly one standing backup in this app').toHaveLength(1);
    expect(calls[0].replace(/\s+/g, ' ').trim())
      .toBe("{ app: 'mitreden', produce: exportEverything }");
  });

  it('never appears in a backup, however the settings are shaped', async () => {
    await saveSettings({ voice: 'de_DE-thorsten', azure: { key: 'sk-geheim-123', region: 'westeurope' } });

    const json = JSON.stringify(await exportEverything());

    expect(json).not.toContain('sk-geheim-123');
    expect(json).not.toContain('westeurope');
    expect(json).not.toContain('azure');
  });

  it('the voice choice does travel, because it is a preference and not a secret', async () => {
    await saveSettings({ voice: 'de_DE-thorsten', azure: { key: 'sk-geheim-123', region: 'we' } });
    expect((await exportEverything()).settings.voice).toBe('de_DE-thorsten');
  });

  /*
   * stripSecrets is an allow-list, and this is the test that says why. A
   * future field on Settings — a second key, a token, an account id — must be
   * excluded by default rather than shipped by default.
   */
  it('a field nobody has classified yet is dropped, not carried', () => {
    const future = { voice: 'x', azure: { key: 'k', region: 'r' }, elevenLabsToken: 'tok-999' };
    expect(stripSecrets(future as never)).toEqual({ voice: 'x' });
  });
});

describe('the round trip', () => {
  beforeEach(() => wipe());

  /** A library of three Sammlungen with sentences spread across them. */
  async function seed(): Promise<void> {
    await saveCollections([
      { key: 'kueche', name: 'Küche' },
      { key: 'schule', name: 'Schule' },
      { key: 'oma', name: 'Bei Oma' },
    ]);
    await savePhrases([
      { id: 'p1', text: 'Ich möchte Wasser', collections: ['kueche'] },
      { id: 'p2', text: 'Ich habe Hunger', collections: ['kueche', 'oma'] },
      { id: 'p3', text: 'Wann ist Pause', collections: ['schule'] },
    ]);
  }

  /*
   * The gap this format was built to close. The old export wrote a bare array
   * and the old import funnelled everything into one new Sammlung, so a
   * library went out whole and came back as a heap — a working export and a
   * working import either side of a lossy trip.
   */
  it('keeps the Sammlungen apart instead of collapsing them into one', async () => {
    await seed();
    const backup = await exportEverything();
    await wipe();

    const done = await importBackup(backup);

    expect(done.collections).toBe(3);
    expect(done.added).toBe(3);
    expect((await loadCollections()).map((c) => c.name).sort())
      .toEqual(['Bei Oma', 'Küche', 'Schule']);
  });

  it('keeps which sentence belonged where, including the one in two places', async () => {
    await seed();
    const backup = await exportEverything();
    await wipe();
    await importBackup(backup);

    const restored = await loadPhrases();
    const hunger = restored.find((one) => one.text === 'Ich habe Hunger');
    expect(hunger?.collections.sort()).toEqual(['kueche', 'oma']);
  });

  it('adds rather than overwrites, so restoring cannot destroy existing work', async () => {
    await seed();
    const backup = await exportEverything();
    // Not a wipe: somebody restoring onto a library that already has something.
    await savePhrases([{ id: 'own', text: 'Mein eigener Satz', collections: ['kueche'] }]);

    await importBackup(backup);

    const texts = (await loadPhrases()).map((one) => one.text);
    expect(texts).toContain('Mein eigener Satz');
    expect(texts).toContain('Wann ist Pause');
  });

  it('renames a colliding Sammlung rather than merging into it', async () => {
    await seed();
    const backup = await exportEverything();
    // The keys are all still taken — a restore on top of the same library.
    const done = await importBackup(backup);

    expect(done.collections).toBe(3);
    const names = (await loadCollections()).map((c) => c.name);
    expect(names).toContain('Küche');
    expect(names).toContain('Küche (importiert)');
  });

  it('merges a sentence that is already here instead of duplicating it', async () => {
    await seed();
    const backup = await exportEverything();
    const done = await importBackup(backup);

    expect(done.merged).toBe(3);
    expect(done.added).toBe(0);
    expect((await loadPhrases()).length).toBe(3);
  });

  it('refuses a file from a newer mitreden rather than reading it wrong', async () => {
    await expect(importBackup({ ...(await exportEverything()), version: 99 }))
      .rejects.toThrow(/neueren Version/);
  });

  it('recognises its own files and not other shapes', async () => {
    expect(isBackup(await exportEverything())).toBe(true);
    expect(isBackup([{ text: 'bare list' }])).toBe(false);
    expect(isBackup({ format: 'bildhaft-backup' })).toBe(false);
    expect(isBackup(null)).toBe(false);
  });

  it('carries no recordings, and says so in the file', async () => {
    await seed();
    const backup = await exportEverything();

    expect(JSON.stringify(backup)).not.toContain('base64');
    expect(backup.notice).toContain('keine Aufnahmen');
    expect(backup.format).toBe(BACKUP_FORMAT);
  });

  it('keeps a voice and its fingerprint together or drops both', async () => {
    await saveCollections([{ key: 'k', name: 'K' }]);
    // A fingerprint without the voice it was taken with cannot decide
    // staleness, and would make a missing recording look current.
    await savePhrases([
      { id: 'a', text: 'Mit Stimme', collections: ['k'], voice: 'v1', fingerprint: 'f1' },
      { id: 'b', text: 'Ohne Stimme', collections: ['k'], fingerprint: 'verwaist' },
    ]);
    const backup = await exportEverything();
    await wipe();
    await importBackup(backup);

    const restored = await loadPhrases();
    expect(restored.find((o) => o.text === 'Mit Stimme')).toMatchObject({ voice: 'v1', fingerprint: 'f1' });
    expect(restored.find((o) => o.text === 'Ohne Stimme')?.fingerprint).toBeUndefined();
  });
});
