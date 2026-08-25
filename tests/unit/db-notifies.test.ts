import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropAudio, dropCollection, dropPhrase, onChanged, putAudio, putCollection,
  putCollections, putPhrase, putPhrases, saveSettings, wipe,
} from '../../src/db/db.ts';

/**
 * Every write that changes what a Sicherung would contain must reach
 * `onChanged`, because that notifier is the only thing between an edit and the
 * standing backup.
 *
 * The guard is against a quiet failure: somebody adds a writer next year,
 * never having heard of the backup, and the library stops being saved. Nothing
 * else would notice — it keeps working for everything that was wired.
 *
 * The list below is longer than it was, and that is the point of it. Two array
 * writers used to stand for every change there was: everything went through
 * savePhrases or saveCollections, so the notifier was easy to get right and
 * said nothing about which edit had happened. Records mean one writer per kind
 * of change — a sentence, a batch of them, one going, a Sammlung, a Sammlung
 * going — and every one of those is a chance to forget. So each is named here.
 */
describe('the change notifier', () => {
  let heard = 0;
  let stop = () => {};

  beforeEach(async () => {
    await wipe();
    heard = 0;
    stop();
    stop = onChanged(() => { heard++; });
  });

  const phrase = (id: string, text = 'Hallo') => ({ id, text, collections: [] });

  it('putPhrase() announces the write', async () => {
    await putPhrase(phrase('a'));
    expect(heard).toBe(1);
  });

  /* Once for the batch, not once per sentence. It is one transaction and one
   * change to the library; announcing per record would make an import of six
   * hundred lines rewrite the backup file six hundred times. */
  it('putPhrases() announces once for the whole batch', async () => {
    await putPhrases([phrase('a'), phrase('b', 'Tschüss'), phrase('c', 'Bitte')]);
    expect(heard).toBe(1);
  });

  it('putPhrases() with nothing to write announces nothing', async () => {
    await putPhrases([]);
    expect(heard).toBe(0);
  });

  it('dropPhrase() announces — a sentence going is a change to the library', async () => {
    await putPhrase(phrase('a'));
    heard = 0;
    await dropPhrase('a');
    expect(heard).toBe(1);
  });

  it('putCollection() announces the write', async () => {
    await putCollection({ id: 'k', name: 'K' });
    expect(heard).toBe(1);
  });

  it('putCollections() announces once for the whole batch', async () => {
    await putCollections([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    expect(heard).toBe(1);
  });

  /* Deleting a Sammlung also rewrites every sentence that was in it — §4.3,
   * the membership goes and the sentences stay — and both halves are one
   * transaction, so both halves are one announcement. */
  it('dropCollection() announces once, for the Sammlung and its members', async () => {
    await putCollection({ id: 'k', name: 'K' });
    await putPhrases([
      { id: 'a', text: 'Hallo', collections: ['k'] },
      { id: 'b', text: 'Tschüss', collections: ['k'] },
    ]);
    heard = 0;
    await dropCollection('k');
    expect(heard).toBe(1);
  });

  it('dropCollection() on one that is not there announces nothing', async () => {
    await dropCollection('never-existed');
    expect(heard).toBe(0);
  });

  it('saveSettings() announces the write', async () => {
    await saveSettings({ voice: 'v' });
    expect(heard).toBe(1);
  });

  it('wipe() announces, so an emptied library is backed up as empty', async () => {
    await putPhrase(phrase('a'));
    heard = 0;
    await wipe();
    expect(heard).toBe(1);
  });

  /*
   * The deliberate silence, and it is worth a test of its own so that
   * "helpfully" wiring it up later has to argue with something.
   *
   * Recordings are not in the backup: they are reproducible and three orders
   * of magnitude the size. Announcing them would make a build of two hundred
   * sentences rewrite the file two hundred times to say nothing new.
   */
  it('putAudio() and dropAudio() stay quiet — recordings are not in the backup', async () => {
    await putAudio('a', new Blob([new Uint8Array([1, 2, 3])]));
    await dropAudio('a');
    expect(heard).toBe(0);
  });

  it('stops telling a listener that unsubscribed', async () => {
    stop();
    await putPhrase(phrase('a'));
    expect(heard).toBe(0);
  });
});
