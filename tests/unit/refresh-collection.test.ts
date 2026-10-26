import { beforeEach, describe, expect, it } from 'vitest';
import { createCollection, refreshCollection } from '../../src/db/repo.ts';
import { allPhrases, phrasesIn, putPhrases } from '../../src/db/phrases.ts';
import { allCollections } from '../../src/db/collections.ts';
import { wipe } from '../../src/db/wipe.ts';

/**
 * The same Sammlung again, out of a newer file.
 *
 * Importing adds and never overwrites — the rule at the head of db/backup.ts,
 * and bildhaft's import follows it too (it mints a fresh id for every
 * collection and every sentence). That is right for a file arriving: a file
 * that could land on top of an existing Sammlung is a file that can destroy an
 * afternoon, and ids are minted rather than carried precisely so it cannot.
 *
 * What it is not right for is the Klettspiel that changed. Two cards added, one
 * taken out, three words now on four cards instead of two — and the choice was
 * a second Sammlung beside the first, or re-typing. So the Sammlung remembers
 * which file it came from (Collection.origin) and the import can offer to
 * bring it up to date instead.
 *
 * Nothing here is allowed to lose a recording. A sentence the file no longer
 * names is *reported*, not removed: there is no way back into a Sammlung in
 * this product's UI, so taking one out would be a one-way door nobody opened
 * on purpose. What becomes of them is asked afterwards, by the page.
 */

const sentences = [
  { id: 'fuchs', text: 'Fuchs', collection: 'wald', copies: 2 },
  { id: 'eule', text: 'Eule', collection: 'wald' },
  { id: 'hase', text: 'Hase', collection: 'wald', voice: 'v1', fingerprint: 'f1' },
];

describe('a Sammlung brought up to date from a newer file', () => {
  beforeEach(async () => {
    await wipe();
    await putPhrases(sentences);
  });

  it('moves the counts the file names, and leaves the rest of the row alone', async () => {
    const done = await refreshCollection('wald', [
      { text: 'Fuchs', copies: 5 },
      { text: 'Eule', copies: 3 },
      { text: 'Hase', voice: 'v1' },
    ]);

    expect(done.changed).toBe(2);
    expect(done.added).toBe(0);
    const held = new Map((await phrasesIn('wald')).map((one) => [one.text, one]));
    expect(held.get('Fuchs')?.copies).toBe(5);
    expect(held.get('Eule')?.copies).toBe(3);
    // The recording is not touched: nothing about the text changed, so nothing
    // about what it sounds like did either.
    expect(held.get('Hase')).toMatchObject({ voice: 'v1', fingerprint: 'f1' });
  });

  it('takes a count back off a card that is down to one', async () => {
    // Absent is the ordinary case, so a card that went from two to one loses
    // the field rather than keeping a 1 — see Phrase.copies.
    const done = await refreshCollection('wald', [{ text: 'Fuchs' }]);
    expect(done.changed).toBe(1);
    expect('copies' in ((await phrasesIn('wald')).find((o) => o.text === 'Fuchs') ?? {}))
      .toBe(false);
  });

  it('adds the cards the file has gained', async () => {
    const done = await refreshCollection('wald', [
      { text: 'Fuchs', copies: 2 }, { text: 'Eule' }, { text: 'Hase' },
      { text: 'Dachs', copies: 3 },
    ]);

    expect(done.added).toBe(1);
    expect(done.changed).toBe(0);
    const held = await phrasesIn('wald');
    expect(held).toHaveLength(4);
    expect(held.find((one) => one.text === 'Dachs')?.copies).toBe(3);
  });

  it('names what the file no longer has without touching it', async () => {
    const done = await refreshCollection('wald', [{ text: 'Fuchs', copies: 2 }]);

    const held = await phrasesIn('wald');
    expect(done.gone).toEqual(['eule', 'hase']);
    // Still there, still in the Sammlung, still recorded. The page asks.
    expect(held).toHaveLength(3);
    expect(held.find((one) => one.id === 'hase')).toMatchObject({ fingerprint: 'f1' });
  });

  it('matches on the text the way twins are found, not on the exact letters', async () => {
    // „ich   habe hunger." is the same sentence as „Ich habe Hunger." for every
    // other purpose here, and a refresh that disagreed would add a second row
    // of it on every import.
    const done = await refreshCollection('wald', [{ text: '  fuchs  ', copies: 4 }]);
    expect(done.added).toBe(0);
    expect(done.changed).toBe(1);
    // The text stays as it is: the file's spelling is not news about the
    // sentence, and rewriting it would re-key what this product has learned.
    expect((await phrasesIn('wald')).find((one) => one.id === 'fuchs')?.text).toBe('Fuchs');
  });

  it('leaves every other Sammlung out of it', async () => {
    await putPhrases([{ id: 'woanders', text: 'Fuchs', collection: 'anderswo', copies: 9 }]);
    await refreshCollection('wald', [{ text: 'Fuchs', copies: 2 }]);
    expect((await allPhrases()).find((one) => one.id === 'woanders')?.copies).toBe(9);
  });
});

describe('which file a Sammlung came from', () => {
  beforeEach(() => wipe());

  it('is remembered when one is named, and absent otherwise', async () => {
    // The id the file had, kept so the next version of that file can be
    // recognised. Never this product's own id — it is somebody else's, and it
    // is evidence about where the Sammlung came from, not identity here.
    const made = await createCollection('Tiere im Wald', true, undefined, 'c1');
    const plain = await createCollection('Von Hand', true);

    const held = new Map((await allCollections()).map((one) => [one.name, one]));
    expect(held.get('Tiere im Wald')?.origin).toBe('c1');
    expect('origin' in (held.get('Von Hand') ?? {})).toBe(false);
    expect(made.origin).toBe('c1');
    expect(plain.origin).toBeUndefined();
  });
});
