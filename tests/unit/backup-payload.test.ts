import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT, exportEverything, importBackup, isBackup, stripSecrets, TOO_NEW,
} from '../../src/db/backup.ts';
import de from '../../src/i18n/de.json';
import en from '../../src/i18n/en.json';
import {
  allCollections, allPhrases, putCollections, putPhrases, saveSettings, wipe,
} from '../../src/db/db.ts';

/**
 * What may reach a folder that is very likely inside Dropbox.
 *
 * Choosing a folder is choosing to have a sync client carry the file off the
 * machine — to somebody's cloud, then to every device sharing the folder. So
 * this file is about two things: that the credential never makes the trip, and
 * that a library which does make it comes back whole.
 */
/** Stands in for whatever sentence the page passes. The real ones live in the
 *  language tables and are checked against those, below. */
const NOTICE = 'what this file does and does not contain';

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
    expect(source.match(/new Sicherung\(/g) ?? [],
      'expected exactly one standing backup in this app').toHaveLength(1);
    expect(source).toContain("app: 'mitreden'");

    // The whole of what produce is, matched exactly rather than loosely:
    // swapping in a database read — or adding an argument — fails here rather
    // than quietly uploading something new.
    expect(source.match(/^\s*produce: (.+)$/m)?.[1])
      .toBe("() => exportEverything(t('backup_notice')),");
  });

  it('never appears in a backup, however the settings are shaped', async () => {
    await saveSettings({ voice: 'de_DE-thorsten', azure: { key: 'sk-geheim-123', region: 'westeurope' } });

    const json = JSON.stringify(await exportEverything(NOTICE));

    expect(json).not.toContain('sk-geheim-123');
    expect(json).not.toContain('westeurope');
    expect(json).not.toContain('azure');
  });

  it('the voice choice does travel, because it is a preference and not a secret', async () => {
    await saveSettings({ voice: 'de_DE-thorsten', azure: { key: 'sk-geheim-123', region: 'we' } });
    expect((await exportEverything(NOTICE)).settings.voice).toBe('de_DE-thorsten');
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
    await putCollections([
      { id: 'kueche', name: 'Küche' },
      { id: 'schule', name: 'Schule' },
      { id: 'oma', name: 'Bei Oma' },
    ]);
    await putPhrases([
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
    const backup = await exportEverything(NOTICE);
    await wipe();

    const done = await importBackup(backup);

    expect(done.collections).toBe(3);
    expect(done.added).toBe(3);
    expect((await allCollections()).map((c) => c.name).sort())
      .toEqual(['Bei Oma', 'Küche', 'Schule']);
  });

  it('keeps which sentence belonged where, including the one in two places', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    await wipe();
    await importBackup(backup);

    const restored = await allPhrases();
    const hunger = restored.find((one) => one.text === 'Ich habe Hunger');

    /* Resolved through the names rather than compared against the ids in the
       file. Every arriving Sammlung is minted a fresh id (§1.1, §1.10), so the
       ids on a restored sentence are deliberately *not* the ones exported —
       what has to survive the trip is which Sammlungen the sentence is in, and
       that is a question about names. Asserting the literal ids tested the old
       identity scheme rather than this property, and would have gone green
       against a restore that carried the ids across and dropped the names. */
    const named = new Map((await allCollections()).map((c) => [c.id, c.name]));
    expect(hunger?.collections.map((id) => named.get(id)).sort())
      .toEqual(['Bei Oma', 'Küche']);
  });

  it('adds rather than overwrites, so restoring cannot destroy existing work', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    // Not a wipe: somebody restoring onto a library that already has something.
    await putPhrases([{ id: 'own', text: 'Mein eigener Satz', collections: ['kueche'] }]);

    await importBackup(backup);

    const texts = (await allPhrases()).map((one) => one.text);
    expect(texts).toContain('Mein eigener Satz');
    expect(texts).toContain('Wann ist Pause');
  });

  it('renames a colliding Sammlung rather than merging into it', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    // The keys are all still taken — a restore on top of the same library.
    const done = await importBackup(backup);

    expect(done.collections).toBe(3);
    const names = (await allCollections()).map((c) => c.name);
    expect(names).toContain('Küche');
    expect(names).toContain('Küche (importiert)');
  });

  it('merges a sentence that is already here instead of duplicating it', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    const done = await importBackup(backup);

    expect(done.merged).toBe(3);
    expect(done.added).toBe(0);
    expect((await allPhrases()).length).toBe(3);
  });

  it('refuses a file from a newer mitreden rather than reading it wrong', async () => {
    await expect(importBackup({ ...(await exportEverything(NOTICE)), version: 99 }))
      .rejects.toThrow(TOO_NEW);
  });

  it('recognises its own files and not other shapes', async () => {
    expect(isBackup(await exportEverything(NOTICE))).toBe(true);
    expect(isBackup([{ text: 'bare list' }])).toBe(false);
    expect(isBackup({ format: 'bildhaft-backup' })).toBe(false);
    expect(isBackup(null)).toBe(false);
  });

  it('carries no recordings, and the notice it was handed', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);

    expect(JSON.stringify(backup)).not.toContain('base64');
    expect(backup.notice).toBe(NOTICE);
    expect(backup.format).toBe(BACKUP_FORMAT);
  });

  /* And the sentence the page actually hands it, in both languages. Somebody
   * who receives one of these files has to be able to tell what is in it, and
   * mitreden ships in two languages — a German-only notice would hand an
   * English reader an explanation they cannot use. */
  it('says in every language that recordings and the key are absent', () => {
    for (const [name, table] of [['de', de], ['en', en]] as const) {
      const notice = (table as Record<string, string>).backup_notice;
      expect(notice, `${name} has no notice`).toBeTruthy();
      expect(notice, `${name} notice omits the key`).toContain('Azure');
    }
    expect(de.backup_notice).toContain('keine Aufnahmen');
    expect(en.backup_notice).toContain('no recordings');
  });

  it('keeps a voice and its fingerprint together or drops both', async () => {
    await putCollections([{ id: 'k', name: 'K' }]);
    // A fingerprint without the voice it was taken with cannot decide
    // staleness, and would make a missing recording look current.
    await putPhrases([
      { id: 'a', text: 'Mit Stimme', collections: ['k'], voice: 'v1', fingerprint: 'f1' },
      { id: 'b', text: 'Ohne Stimme', collections: ['k'], fingerprint: 'verwaist' },
    ]);
    const backup = await exportEverything(NOTICE);
    await wipe();
    await importBackup(backup);

    const restored = await allPhrases();
    expect(restored.find((o) => o.text === 'Mit Stimme')).toMatchObject({ voice: 'v1', fingerprint: 'f1' });
    expect(restored.find((o) => o.text === 'Ohne Stimme')?.fingerprint).toBeUndefined();
  });
});
