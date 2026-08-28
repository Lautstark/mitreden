import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT, exportEverything, importBackup, isBackup, stripSecrets, TOO_NEW,
} from '../../src/db/backup.ts';
import de from '../../src/i18n/de.json';
import en from '../../src/i18n/en.json';
import {
  allCollections, allPhrases, countIn, putCollections, putPhrases, saveSettings,
  wipe,
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
      { id: 'p1', text: 'Ich möchte Wasser', collection: 'kueche' },
      // The same sentence in two Sammlungen, which is two rows now.
      { id: 'p2', text: 'Ich habe Hunger', collection: 'kueche' },
      { id: 'p2-2', text: 'Ich habe Hunger', collection: 'oma' },
      { id: 'p3', text: 'Wann ist Pause', collection: 'schule' },
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
    expect(done.added).toBe(4);
    expect((await allCollections()).map((c) => c.name).sort())
      .toEqual(['Bei Oma', 'Küche', 'Schule']);
  });

  it('keeps which sentence belonged where, including the text in two places', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    await wipe();
    await importBackup(backup);

    const restored = await allPhrases();
    const hunger = restored.filter((one) => one.text === 'Ich habe Hunger');

    /* Resolved through the names rather than compared against the ids in the
       file. Every arriving Sammlung is minted a fresh id (§1.1, §1.10), so the
       ids on a restored sentence are deliberately *not* the ones exported —
       what has to survive the trip is which Sammlungen the sentence is in, and
       that is a question about names. Asserting the literal ids tested the old
       identity scheme rather than this property, and would have gone green
       against a restore that carried the ids across and dropped the names. */
    const named = new Map((await allCollections()).map((c) => [c.id, c.name]));
    expect(hunger.map((one) => named.get(one.collection!)).sort())
      .toEqual(['Bei Oma', 'Küche']);
  });

  it('adds rather than overwrites, so restoring cannot destroy existing work', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    // Not a wipe: somebody restoring onto a library that already has something.
    await putPhrases([{ id: 'own', text: 'Mein eigener Satz', collection: 'kueche' }]);

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

  /*
   * A restore onto the same library used to merge every sentence into the row
   * that was already there, because a row could hold both memberships. It
   * cannot, and the Sammlungen it merged into were never the arriving ones
   * anyway: §1.10 mints a fresh id for every Sammlung in the file, so the
   * "Küche (importiert)" above is a different place from the Küche. Its
   * sentences belong in it, and they arrive.
   *
   * Which is the same rule stated at the top of importBackup — adds, never
   * overwrites — reaching the sentences as well as the Sammlungen.
   */
  it('fills the Sammlung it restored rather than merging into the one here', async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    const done = await importBackup(backup);

    expect(done.merged).toBe(0);
    expect(done.added).toBe(4);
    expect((await allPhrases()).length).toBe(8);
    // And nothing was pulled out of the Sammlungen that were already here.
    const named = new Map((await allCollections()).map((c) => [c.name, c.id]));
    expect(await countIn(named.get('Küche')!)).toBe(2);
    expect(await countIn(named.get('Küche (importiert)')!)).toBe(2);
  });

  /* What merging still means: the same text twice in one arriving Sammlung. It
     is the only shape left where two rows would be two of the same thing in the
     same place. */
  it('merges a sentence the file has twice in one Sammlung', async () => {
    const file = await exportEverything(NOTICE);
    const done = await importBackup({
      ...file,
      collections: [{ id: 'k', name: 'Küche' }],
      phrases: [
        { id: 'a', text: 'Ich habe Hunger', collection: 'k' },
        { id: 'b', text: 'ich   habe hunger', collection: 'k' },
      ],
    });

    expect(done.added).toBe(1);
    expect(done.merged).toBe(1);
  });

  /*
   * A version 1 file, which is every Sicherung anybody already has: a sentence
   * names every Sammlung it was in. It restores the way the version 4 migration
   * splits — one row per Sammlung — because that is the same question asked of
   * the same shape, and the arrangement the file recorded is worth keeping.
   */
  it('splits a version 1 sentence that was in two Sammlungen', async () => {
    const file = await exportEverything(NOTICE);
    const done = await importBackup({
      ...file,
      version: 1,
      collections: [{ id: 'k', name: 'Küche' }, { id: 'o', name: 'Bei Oma' }],
      phrases: [{
        id: 'p', text: 'Ich habe Hunger', collections: ['k', 'o'],
        voice: 'piper:de_DE-thorsten-medium', fingerprint: 'aaaaaaaaaaaa',
      }] as never,
    });

    expect(done.added).toBe(2);
    const named = new Map((await allCollections()).map((c) => [c.id, c.name]));
    expect((await allPhrases()).map((one) => named.get(one.collection!)).sort())
      .toEqual(['Bei Oma', 'Küche']);
    // Both keep the voice and the mark, which travel together and are what say
    // whether a re-recording would come out sounding the same.
    for (const one of await allPhrases()) {
      expect(one.voice).toBe('piper:de_DE-thorsten-medium');
      expect(one.fingerprint).toBe('aaaaaaaaaaaa');
    }
  });

  /* A file written before Collection.voice existed still lands with the voices
     it was made in: the sentences say what they were recorded in, and the
     Sammlung takes the one most of them used. */
  it('gives a version 1 Sammlung the voice its sentences were recorded in', async () => {
    const file = await exportEverything(NOTICE);
    await importBackup({
      ...file,
      version: 1,
      settings: { voice: 'piper:de_DE-kerstin-low' },
      collections: [{ id: 'k', name: 'Küche' }, { id: 'l', name: 'Leer' }],
      phrases: [
        { id: 'a', text: 'Eins', collections: ['k'], voice: 'piper:de_DE-thorsten-medium' },
        { id: 'b', text: 'Zwei', collections: ['k'], voice: 'piper:de_DE-thorsten-medium' },
        { id: 'c', text: 'Drei', collections: ['k'], voice: 'piper:de_DE-kerstin-low' },
      ] as never,
    });

    const voices = new Map((await allCollections()).map((c) => [c.name, c.voice]));
    expect(voices.get('Küche'), 'two against one').toBe('piper:de_DE-thorsten-medium');
    expect(voices.get('Leer'), 'nothing to vote with, so the file’s own default')
      .toBe('piper:de_DE-kerstin-low');
  });

  /* The number moved because the shape did, and this is what the number is for:
     a mitreden from before this change would read a version 2 file, find no
     `collections` anywhere, and restore the library as one uncollected heap. */
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
      { id: 'a', text: 'Mit Stimme', collection: 'k', voice: 'v1', fingerprint: 'f1' },
      { id: 'b', text: 'Ohne Stimme', collection: 'k', fingerprint: 'verwaist' },
    ]);
    const backup = await exportEverything(NOTICE);
    await wipe();
    await importBackup(backup);

    const restored = await allPhrases();
    expect(restored.find((o) => o.text === 'Mit Stimme')).toMatchObject({ voice: 'v1', fingerprint: 'f1' });
    expect(restored.find((o) => o.text === 'Ohne Stimme')?.fingerprint).toBeUndefined();
  });
});
