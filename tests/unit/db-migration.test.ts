import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A version 3 library meeting version 4, and the one thing it must not do.
 *
 * Every earlier upgrade in this file's neighbour dropped what it found, and
 * that was the decision rather than an omission. This one carries across,
 * because the change under it moves the voice from the sentence to the
 * Sammlung, and the alternative to carrying across is asking somebody to
 * re-record their library in an arrangement they have not seen yet.
 *
 * So the claim being tested is: **no recording is lost.** Not "the shape is
 * right" — a shape that is right with a clip missing is the failure this is
 * about. The seed therefore has audio under every sentence that would have had
 * it, including the one in two Sammlungen, which is the only sentence in the
 * old shape that cannot simply be renamed into the new one.
 *
 * The version 3 database is written out here rather than built with db.ts,
 * because the point is to reproduce what is on somebody's disk. A helper that
 * moved with the code would test the new shape against itself.
 */

const DB_NAME = 'mitreden';

const THORSTEN = 'piper:de_DE-thorsten-medium';
const KERSTIN = 'piper:de_DE-kerstin-low';

const bytes = (n: number): Blob => new Blob([new Uint8Array([n, n, n])]);

/** Version 3, made the way version 3 made it: the stores are the current ones
 *  but for the membership, which is a multiEntry index over an array. */
function seedVersionThree(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      const phrases = database.createObjectStore('phrases', { keyPath: 'id' });
      phrases.createIndex('collections', 'collections', { multiEntry: true });
      phrases.createIndex('norm', 'norm');
      database.createObjectStore('collections', { keyPath: 'id' })
        .createIndex('updatedAt', 'updatedAt');
      database.createObjectStore('settings');
      database.createObjectStore('audio');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(
        ['phrases', 'collections', 'settings', 'audio'], 'readwrite',
      );
      const phrases = tx.objectStore('phrases');
      for (const one of [
        {
          id: 'hunger', text: 'Ich habe Hunger.', norm: 'ich habe hunger.',
          collections: ['kueche'], voice: THORSTEN, fingerprint: 'aaaaaaaaaaaa',
        },
        // The one this change cannot simply rename: two Sammlungen, one row,
        // one recording behind both.
        {
          id: 'mude', text: 'Ich bin müde.', norm: 'ich bin müde.',
          collections: ['kueche', 'schlafen'], voice: THORSTEN,
          fingerprint: 'bbbbbbbbbbbb',
        },
        // The Küche's minority voice: it loses the vote and keeps its clip.
        {
          id: 'durst', text: 'Ich habe Durst.', norm: 'ich habe durst.',
          collections: ['kueche'], voice: KERSTIN, fingerprint: 'cccccccccccc',
        },
        // A dead heat in Bei Oma, which the settings voice breaks.
        {
          id: 'oma1', text: 'Bei Oma.', norm: 'bei oma.',
          collections: ['oma'], voice: THORSTEN, fingerprint: 'dddddddddddd',
        },
        {
          id: 'oma2', text: 'Noch bei Oma.', norm: 'noch bei oma.',
          collections: ['oma'], voice: KERSTIN, fingerprint: 'eeeeeeeeeeee',
        },
        // In none, and never recorded. Both are real states.
        { id: 'allein', text: 'Nichts für niemanden.', norm: 'nichts für niemanden.', collections: [] },
        // Naming a Sammlung that is not here, which a restore leaves on purpose.
        { id: 'fremd', text: 'Woanders.', norm: 'woanders.', collections: ['weg'] },
      ]) phrases.put(one);

      const collections = tx.objectStore('collections');
      collections.put({ id: 'kueche', name: 'Küche', updatedAt: 1 });
      collections.put({ id: 'schlafen', name: 'Schlafen', updatedAt: 2 });
      collections.put({ id: 'oma', name: 'Bei Oma', updatedAt: 3 });
      // Nothing in it, so nothing to vote with.
      collections.put({ id: 'leer', name: 'Leer', updatedAt: 4 });

      tx.objectStore('settings').put({ voice: THORSTEN, open: ['kueche'] }, 'settings');

      const audio = tx.objectStore('audio');
      audio.put(bytes(1), 'hunger');
      audio.put(bytes(2), 'mude');
      audio.put(bytes(3), 'durst');
      audio.put(bytes(4), 'oma1');
      audio.put(bytes(5), 'oma2');

      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/* Imported after the old database exists, not before: db.ts opens lazily, but a
 * top-level import that ever grew an eager open would make this file quietly
 * test nothing. */
let store: typeof import('../../src/db/db.ts');

beforeAll(async () => {
  await seedVersionThree();
  store = await import('../../src/db/db.ts');
});

const read = async (id: string) => (await store.allPhrases()).find((one) => one.id === id);

describe('a version 3 library carried into version 4', () => {
  it('upgrades without throwing, so the store answers at all', async () => {
    await expect(store.allCollections()).resolves.toBeTruthy();
  });

  /* The whole point. Everything that had a clip still has one, and the split
     sentence has two, because it is two sentences now and both are in a
     Sammlung somebody is going to hand to a device. */
  it('loses no recording', async () => {
    for (const id of ['hunger', 'mude', 'durst', 'oma1', 'oma2']) {
      expect(await store.getAudio(id), `${id} kept its recording`).toBeTruthy();
    }
    const split = (await store.allPhrases())
      .find((one) => one.text === 'Ich bin müde.' && one.id !== 'mude');
    expect(split, 'the second Sammlung got a row').toBeTruthy();
    expect(await store.getAudio(split!.id), 'and a copy of the clip').toBeTruthy();
    expect(await (await store.getAudio(split!.id))!.text(),
      'the same bytes, because it is the same text in the same voice')
      .toBe(await (await store.getAudio('mude'))!.text());
  });

  it('re-records nothing, because the split row is a copy in every respect', async () => {
    const split = (await store.allPhrases())
      .find((one) => one.text === 'Ich bin müde.' && one.id !== 'mude')!;
    expect(split.voice).toBe(THORSTEN);
    // The mark it had, not a fresh one. A fresh one over the same text in the
    // same voice is the same string — and taking it would have meant awaiting
    // crypto inside a versionchange transaction, which commits it halfway.
    expect(split.fingerprint).toBe('bbbbbbbbbbbb');
  });

  it('keeps the original where it was, id and all', async () => {
    // The id is a file name and the file may be on a talker, so the row that
    // keeps it is the one in the Sammlung the sentence was first added to.
    const kept = await read('mude');
    expect(kept?.collection).toBe('kueche');
    expect(kept?.voice).toBe(THORSTEN);
  });

  it('turns one membership into one Sammlung and leaves the rest alone', async () => {
    expect((await read('hunger'))?.collection).toBe('kueche');
    expect((await read('durst'))?.collection).toBe('kueche');
  });

  it('leaves a sentence in no Sammlung in none, rather than inventing one', async () => {
    expect((await read('allein'))?.collection).toBeUndefined();
    expect((await store.allPhrases()).map((one) => one.id), 'and it is still here')
      .toContain('allein');
  });

  it('keeps a tag naming a Sammlung that is not here', async () => {
    // A restore leaves these on purpose, so the sentence reappears if that
    // Sammlung ever comes back.
    expect((await read('fremd'))?.collection).toBe('weg');
  });

  /* The vote. Whichever voice the most sentences already carry wins, because
     that is the reading that leaves the fewest of them stale — and the loser
     keeps its clip either way. */
  it('gives each Sammlung the voice most of its sentences were recorded in', async () => {
    const named = new Map((await store.allCollections()).map((c) => [c.id, c.voice]));
    expect(named.get('kueche'), 'two Thorsten against one Kerstin').toBe(THORSTEN);
    expect(named.get('schlafen'), 'from the row it gained').toBe(THORSTEN);
  });

  it('breaks a dead heat with the settings voice', async () => {
    const named = new Map((await store.allCollections()).map((c) => [c.id, c.voice]));
    expect(named.get('oma')).toBe(THORSTEN);
  });

  it('leaves a Sammlung with nothing to vote with without a voice', async () => {
    // Which is not a gap: it follows the settings default, the way everything
    // without a voice of its own does.
    const named = new Map((await store.allCollections()).map((c) => [c.id, c.voice]));
    expect(named.get('leer')).toBeUndefined();
  });

  it('keeps the settings, which say what the default is now for', async () => {
    expect(await store.loadSettings()).toEqual({ voice: THORSTEN, open: ['kueche'] });
  });

  /* The index was replaced, not just the field: a multiEntry index over an
     array became an ordinary one over a string, inside the same versionchange
     transaction that rewrote every record. */
  it('answers off the new membership index', async () => {
    expect(await store.countIn('kueche')).toBe(3);
    expect(await store.countIn('schlafen')).toBe(1);
    expect((await store.phrasesIn('schlafen')).map((one) => one.text)).toEqual(['Ich bin müde.']);
    expect(await store.countIn('leer')).toBe(0);
  });

  it('answers off the twin index, with both rows of the split sentence', async () => {
    expect((await store.twinsOf('ICH bin  müde.')).map((one) => one.collection).sort())
      .toEqual(['kueche', 'schlafen']);
  });

  /* And it is an ordinary database afterwards. A failed upgrade leaves db()
     rejecting for the life of the page, which looks like an app that loads and
     then does nothing when you type. */
  it('takes a write afterwards', async () => {
    await store.putPhrases([{ id: 'neu', text: 'Noch ein Satz.', collection: 'leer' }]);
    expect(await store.countIn('leer')).toBe(1);
  });
});
