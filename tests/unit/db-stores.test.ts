import { beforeEach, describe, expect, it } from 'vitest';
import {
  allCollections, allPhrases, countIn, countPhrases, dropCollection, getPhrase,
  phrasesIn, putCollection, putCollections, putPhrases, twinOf, wipe,
} from '../../src/db/db.ts';
import { collections, editPhrase } from '../../src/db/repo.ts';
import { exportEverything } from '../../src/db/backup.ts';

/**
 * What the stores buy, as behaviour rather than as shape.
 *
 * conventions.md §2.1 asks for real object stores with indexes and says what
 * they are for; this is that list, each item as the thing a caller can now do.
 * None of it was reachable while the library was two JSON arrays under two
 * keys — every one of these questions was a filter over everything, and the
 * answers were the same, which is why nothing here failed before. What changed
 * is the cost, and cost is the one thing a test cannot assert. So these pin the
 * *behaviour* the indexes have to keep having, and the head of db.ts carries
 * the argument about why they are indexes.
 */

const LIBRARY = [
  { id: 'hunger', text: 'Ich habe Hunger.', collections: ['kueche'] },
  { id: 'durst', text: 'Ich habe Durst.', collections: ['kueche'] },
  // The one in two places at once: arity here is many (§4.1), and it is the
  // whole reason the membership index is multiEntry.
  { id: 'mude', text: 'Ich bin müde.', collections: ['kueche', 'schlafen'] },
  { id: 'buch', text: 'Vorlesen, bitte.', collections: ['schlafen'] },
  { id: 'allein', text: 'Nichts für niemanden.', collections: [] },
];

beforeEach(async () => {
  await wipe();
  await putCollections([
    { key: 'kueche', name: 'Küche' },
    { key: 'schlafen', name: 'Schlafen' },
  ]);
  await putPhrases(LIBRARY);
});

describe('the sentences in one Sammlung', () => {
  it('are a query, and one in two places answers to both', async () => {
    expect((await phrasesIn('kueche')).map((p) => p.id).sort())
      .toEqual(['durst', 'hunger', 'mude']);
    expect((await phrasesIn('schlafen')).map((p) => p.id).sort())
      .toEqual(['buch', 'mude']);
  });

  it('leave out the one that is in none', async () => {
    const anywhere = [...await phrasesIn('kueche'), ...await phrasesIn('schlafen')];
    expect(anywhere.map((p) => p.id)).not.toContain('allein');
    expect((await allPhrases()).map((p) => p.id), 'which is still in the library')
      .toContain('allein');
  });

  it('are empty for a Sammlung nothing is in, rather than an error', async () => {
    await putCollection({ key: 'leer', name: 'Leer' });
    expect(await phrasesIn('leer')).toEqual([]);
  });

  /* §1.8 wants this number in every sidebar row, which is what made it worth an
   * index: it used to mean loading the whole library and tallying it. */
  it('are counted without loading any of them', async () => {
    expect(await countIn('kueche')).toBe(3);
    expect(await countIn('schlafen')).toBe(2);
    expect(await countIn('leer')).toBe(0);
    expect(await countPhrases()).toBe(LIBRARY.length);
  });

  it('follow a sentence being moved between Sammlungen', async () => {
    const one = (await getPhrase('durst'))!;
    await putPhrases([{ ...one, collections: ['schlafen'] }]);
    expect(await countIn('kueche')).toBe(2);
    expect((await phrasesIn('schlafen')).map((p) => p.id).sort())
      .toEqual(['buch', 'durst', 'mude']);
  });
});

describe('deleting a Sammlung', () => {
  /* §4.3: mitreden drops the membership and keeps the sentences, where bildhaft
   * and vorlaut delete the contents. Both are right for their model, and this
   * is the half that would be silently wrong if the membership were stripped
   * from the wrong records. */
  it('takes the membership and leaves every sentence', async () => {
    expect(await dropCollection('kueche')).toBe(true);

    expect((await allPhrases()).map((p) => p.id).sort(),
      'the sentences are the irreplaceable half').toEqual(LIBRARY.map((p) => p.id).sort());
    expect(await countIn('kueche')).toBe(0);
  });

  it('leaves the Sammlungen it was not about alone', async () => {
    await dropCollection('kueche');
    expect((await allCollections()).map((c) => c.key)).toEqual(['schlafen']);
    // The one that was in both keeps the other half of its membership.
    expect((await getPhrase('mude'))!.collections).toEqual(['schlafen']);
  });

  it('says so when there was nothing to delete', async () => {
    expect(await dropCollection('never-existed')).toBe(false);
    expect(await allCollections()).toHaveLength(2);
  });
});

describe('a sentence like this one', () => {
  it('is found however it was spaced or capitalised', async () => {
    expect((await twinOf('ICH   habe    hunger.'))?.id).toBe('hunger');
  });

  /* normText keeps punctuation in, because "Nochmal!" and "Nochmal." are
   * spoken differently — so they are two sentences, not a twin. */
  it('is not found when only the punctuation differs', async () => {
    expect(await twinOf('Ich habe Hunger!')).toBeUndefined();
  });

  /* The lookup is an index on a field derived from the text, so the thing that
   * can go wrong is the field surviving an edit that changed the text. It is
   * written in one place for exactly this reason. */
  it('follows the text when a sentence is edited', async () => {
    await editPhrase('hunger', 'Ich möchte etwas essen.');
    expect(await twinOf('Ich habe Hunger.'), 'the old text is nobody now').toBeUndefined();
    expect((await twinOf('ich möchte etwas essen.'))?.id).toBe('hunger');
  });
});

describe('the order the Sammlungen were made in', () => {
  it('is the order they come back in', async () => {
    await putCollection({ key: 'dritte', name: 'Dritte' });
    expect((await allCollections()).map((c) => c.key))
      .toEqual(['kueche', 'schlafen', 'dritte']);
  });

  /* Several arriving at once - a restore - keep the order the file had them in,
   * which one shared timestamp for the batch would throw away.
   *
   * The keys run backwards through the alphabet on purpose. IndexedDB breaks a
   * tie on an index key with the primary key, so a batch that shared one stamp
   * would come back in *key* order - and with keys a, b, c that is the order
   * they went in, and this test would pass while asserting nothing. It did,
   * until a deliberate break failed to fail. */
  it('holds for a batch that arrives inside one millisecond', async () => {
    await wipe();
    await putCollections([
      { key: 'zuletzt', name: 'C' }, { key: 'mitte', name: 'B' }, { key: 'auch', name: 'A' },
    ]);
    expect((await allCollections()).map((c) => c.key))
      .toEqual(['zuletzt', 'mitte', 'auch']);
  });

  it('does not move when one is renamed, because renaming is not making', async () => {
    await putCollection({ key: 'kueche', name: 'Die Küche' });
    expect((await allCollections()).map((c) => c.key)).toEqual(['kueche', 'schlafen']);
    expect((await allCollections())[0]!.name).toBe('Die Küche');
  });
});

/* The number in every sidebar row, through the function that draws it rather
 * than through the index underneath. §1.8's count is the reason that index
 * exists, and the row is where being wrong about it would show. */
describe('every Sammlung with how much is in it', () => {
  it('gives the name and the count, in the order they were made', async () => {
    expect(await collections()).toEqual([
      { key: 'kueche', name: 'Küche', count: 3 },
      { key: 'schlafen', name: 'Schlafen', count: 2 },
    ]);
  });

  it('counts a new one as empty rather than leaving it out', async () => {
    await putCollection({ key: 'leer', name: 'Leer' });
    expect((await collections()).at(-1)).toEqual({ key: 'leer', name: 'Leer', count: 0 });
  });
});

/* The two fields the stores need and the program does not. They are in the
 * record because an index key has to be, and nothing above db.ts has ever
 * wanted them — so if they leak, they leak into a Sicherung, which is a file
 * somebody keeps for years and which this repository has already had one lossy
 * round trip through. */
describe('the bookkeeping the stores need', () => {
  it('does not come back out of the store', async () => {
    for (const one of await allPhrases()) expect(one).not.toHaveProperty('norm');
    for (const one of await allCollections()) expect(one).not.toHaveProperty('createdAt');
    expect(await getPhrase('hunger')).not.toHaveProperty('norm');
  });

  it('does not reach the Sicherung', async () => {
    const file = await exportEverything('notice');
    for (const one of file.phrases) expect(one).not.toHaveProperty('norm');
    for (const one of file.collections) expect(one).not.toHaveProperty('createdAt');
  });
});
