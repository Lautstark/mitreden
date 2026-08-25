import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAudio, putAudio, putCollection, putPhrases, saveSettings, wipe,
} from '../../src/db/db.ts';
import {
  addPhrases, collections, createCollection, phrases, saveCollectionVoice, votedVoice,
} from '../../src/db/repo.ts';
import { fingerprint } from '../../src/core/ids.ts';

/**
 * Which voice a sentence records in, now that the answer is the Sammlung's.
 *
 * Three questions, and one rule under all of them: the Sammlung's voice, or the
 * settings voice when there is no Sammlung or the Sammlung has none. What used
 * to happen was that the *sentence* carried the voice and nothing chose it —
 * `item.voice ?? chosenVoice()` — so the stored voice was a record of what had
 * been used rather than an answer anybody gave.
 *
 * The sentence still records what it was made in. That half is not what moved,
 * and it is what makes staleness decidable: the fingerprint is taken over the
 * text and the voice, so handing that same untouched function the *Sammlung's*
 * voice is the whole of what makes changing a Sammlung's voice mark its
 * sentences stale.
 */

const THORSTEN = 'piper:de_DE-thorsten-medium';
const KERSTIN = 'piper:de_DE-kerstin-low';
const KATJA = 'azure:de-DE-KatjaNeural';

const clip = (n: number): Blob => new Blob([new Uint8Array([n, n, n])]);

/** A sentence with a recording that really matches its voice, so that anything
 *  reported stale is reported for a reason and not for want of a fingerprint. */
async function recorded(
  id: string, text: string, voice: string, collection?: string,
): Promise<void> {
  await putPhrases([{
    id, text, ...(collection ? { collection } : {}),
    voice, fingerprint: await fingerprint(text, voice),
  }]);
  await putAudio(id, clip(1));
}

const stateOf = async (id: string): Promise<string | undefined> =>
  (await phrases()).find((one) => one.id === id)?.state;

beforeEach(() => wipe());

describe('the voice a sentence is judged against', () => {
  it('is its Sammlung’s, so changing that makes its sentences stale', async () => {
    await putCollection({ id: 'kueche', name: 'Küche', voice: THORSTEN });
    await recorded('hunger', 'Ich habe Hunger.', THORSTEN, 'kueche');
    expect(await stateOf('hunger'), 'recorded in the voice it records in').toBe('ok');

    await putCollection({ id: 'kueche', name: 'Küche', voice: KERSTIN });
    // The clip is still there and still plays. Stale is the true word for it:
    // it is not the sound this Sammlung makes any more.
    expect(await stateOf('hunger')).toBe('stale');
    expect(await getAudio('hunger'), 'and nothing was thrown away').toBeTruthy();
  });

  it('is the settings voice when the sentence is in no Sammlung', async () => {
    await saveSettings({ voice: THORSTEN });
    await recorded('allein', 'Nichts für niemanden.', THORSTEN);
    expect(await stateOf('allein')).toBe('ok');

    await saveSettings({ voice: KERSTIN });
    expect(await stateOf('allein'),
      'the default moved, and an uncollected sentence follows it').toBe('stale');
  });

  it('is the settings voice when the Sammlung has none', async () => {
    await saveSettings({ voice: THORSTEN });
    await putCollection({ id: 'leer', name: 'Leer' });
    await recorded('hunger', 'Ich habe Hunger.', THORSTEN, 'leer');
    expect(await stateOf('hunger')).toBe('ok');

    await saveSettings({ voice: KERSTIN });
    expect(await stateOf('hunger')).toBe('stale');
  });

  /* A library where nobody has picked a voice at all is not a library of stale
     sentences. There is nothing it disagrees with. */
  it('is what it was recorded in when nothing has decided a voice', async () => {
    await putCollection({ id: 'kueche', name: 'Küche' });
    await recorded('hunger', 'Ich habe Hunger.', THORSTEN, 'kueche');
    expect(await stateOf('hunger')).toBe('ok');
  });
});

describe('a Sammlung being made', () => {
  it('takes the settings voice, which is the default for the next one', async () => {
    await saveSettings({ voice: THORSTEN });
    expect((await createCollection('Küche', true)).voice).toBe(THORSTEN);
  });

  it('takes the voice it is told, which is how an imported file keeps its own', async () => {
    await saveSettings({ voice: THORSTEN });
    expect((await createCollection('Aus einer Datei', true, KERSTIN)).voice).toBe(KERSTIN);
  });

  it('goes without one when nobody has picked a voice yet', async () => {
    expect((await createCollection('Küche', true)).voice).toBeUndefined();
  });
});

describe('writing a Sammlung’s voice', () => {
  /* The one write behind the sheet in the ⋯. It is worth its own test because
     nothing else in this file goes through it: the cases above put a Collection
     into the store by hand, which is what a migration or a restore does, and
     this is what somebody pressing a row in a list does. */
  it('is what makes the sentences in it stale, and takes nothing away', async () => {
    await putCollection({ id: 'kueche', name: 'Küche', voice: THORSTEN });
    await recorded('hunger', 'Ich habe Hunger.', THORSTEN, 'kueche');
    expect(await stateOf('hunger')).toBe('ok');

    await saveCollectionVoice('kueche', KERSTIN);

    expect(await stateOf('hunger')).toBe('stale');
    expect(await getAudio('hunger'), 'the clip is still there and still plays').toBeTruthy();
    // And the sentence still says what it was actually recorded in. That half
    // is build()'s to write and this must not touch it — db/backup.ts needs the
    // voice and the fingerprint to travel together.
    expect((await phrases()).find((one) => one.id === 'hunger')?.voice).toBe(THORSTEN);
  });

  it('reaches one Sammlung and not the default, nor any other', async () => {
    await saveSettings({ voice: THORSTEN });
    await putCollection({ id: 'kueche', name: 'Küche', voice: THORSTEN });
    await putCollection({ id: 'kita', name: 'Kita' });
    await recorded('durst', 'Ich habe Durst.', THORSTEN, 'kita');

    await saveCollectionVoice('kueche', KERSTIN);

    // The Sammlung with no voice of its own goes on following the default,
    // which this did not move.
    expect(await stateOf('durst')).toBe('ok');
    const held = await collections();
    expect(held.find((one) => one.id === 'kita')?.voice).toBeUndefined();
    expect((await createCollection('Danach', true)).voice,
      'the default a new Sammlung starts with is untouched').toBe(THORSTEN);
  });

  it('answers nothing for a Sammlung that is not there', async () => {
    expect(await saveCollectionVoice('weg', KERSTIN)).toBeNull();
  });
});

describe('the voice a file votes for', () => {
  it('is the one most of its sentences were made in', async () => {
    expect(votedVoice([
      { text: 'a', voice: THORSTEN }, { text: 'b', voice: KERSTIN },
      { text: 'c', voice: THORSTEN },
    ])).toBe(THORSTEN);
  });

  it('discounts a voice this browser cannot reach', async () => {
    // An Azure voice with no key would fail every recording in the Sammlung it
    // won, so it does not get to win one.
    expect(votedVoice(
      [{ text: 'a', voice: KATJA }, { text: 'b', voice: KATJA }, { text: 'c', voice: KERSTIN }],
      new Set([THORSTEN, KERSTIN]),
    )).toBe(KERSTIN);
  });

  it('is nothing at all when the file names no voice', async () => {
    expect(votedVoice(['Ich habe Hunger.', 'Ich habe Durst.'])).toBeUndefined();
  });
});

/*
 * The twin. It used to be merged into — the existing row gained the new
 * Sammlung — and one-to-one leaves three ways out: move the row, refuse the
 * sentence, or make a second one. A move empties a Sammlung nobody asked to
 * empty; a refusal stops a Sammlung holding a sentence that belongs in it.
 */
describe('adding a sentence whose text is already here', () => {
  beforeEach(async () => {
    await putCollection({ id: 'morgens', name: 'Morgens', voice: THORSTEN });
    await putCollection({ id: 'kita', name: 'Kita', voice: THORSTEN });
    await recorded('hunger', 'Ich habe Hunger.', THORSTEN, 'morgens');
  });

  it('makes a second row rather than moving the first', async () => {
    const done = await addPhrases(['Ich habe Hunger.'], 'kita');

    expect(done.added).toBe(1);
    expect(done.merged).toBe(0);
    const held = await phrases();
    expect(held.filter((one) => one.text === 'Ich habe Hunger.').map((one) => one.collection).sort())
      .toEqual(['kita', 'morgens']);
    expect(held.find((one) => one.id === 'hunger')?.collection,
      'the morning Sammlung was not quietly emptied').toBe('morgens');
  });

  it('arrives already recorded, by copying the clip rather than making it again', async () => {
    const { ids } = await addPhrases(['Ich habe Hunger.'], 'kita');

    // Both Sammlungen record in Thorsten, so the second row is the same sound.
    // audio is keyed by sentence id, so it is a second key holding a copy —
    // and no second recording.
    expect(await getAudio(ids[0]!)).toBeTruthy();
    expect(await stateOf(ids[0]!), 'so there is nothing left for build() to do').toBe('ok');
  });

  it('does not copy a clip made in a different voice', async () => {
    await putCollection({ id: 'kita', name: 'Kita', voice: KERSTIN });
    const { ids } = await addPhrases(['Ich habe Hunger.'], 'kita');

    // A genuine second recording, because it is a genuinely different sound.
    expect(await getAudio(ids[0]!)).toBeUndefined();
    expect(await stateOf(ids[0]!)).toBe('missing');
  });

  it('is still a merge when it is already in the Sammlung being added to', async () => {
    const done = await addPhrases(['ich   habe hunger.'], 'morgens');

    expect(done.added).toBe(0);
    expect(done.merged).toBe(1);
    expect((await phrases()).filter((one) => one.text === 'Ich habe Hunger.')).toHaveLength(1);
  });

  it('is a merge for two identical lines in one paste, which have no row yet', async () => {
    const done = await addPhrases(['Ganz neu.', 'ganz  neu.'], 'kita');
    expect(done.added).toBe(1);
    expect(done.merged).toBe(1);
  });

  /* Uncollected is a place too: two sentences in none are twins of each other,
     and a sentence in none is not the twin of one in a Sammlung. */
  it('treats no Sammlung as somewhere, for the same question', async () => {
    const first = await addPhrases(['Ich habe Hunger.'], undefined);
    expect(first.added, 'not the twin of the one in Morgens').toBe(1);

    const second = await addPhrases(['Ich habe Hunger.'], undefined);
    expect(second.merged, 'but the twin of the one now in none').toBe(1);
  });
});
