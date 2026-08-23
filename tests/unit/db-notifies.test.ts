import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropAudio, onChanged, putAudio, saveCollections, savePhrases, saveSettings, wipe,
} from '../../src/db/db.ts';

/**
 * Every write that changes what a Sicherung would contain must reach
 * `onChanged`, because that notifier is the only thing between an edit and the
 * standing backup.
 *
 * The guard is against a quiet failure: somebody adds a writer next year,
 * never having heard of the backup, and the library stops being saved. Nothing
 * else would notice — it keeps working for everything that was wired.
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

  it('savePhrases() announces the write', async () => {
    await savePhrases([{ id: 'a', text: 'Hallo', collections: [] }]);
    expect(heard).toBe(1);
  });

  it('saveCollections() announces the write', async () => {
    await saveCollections([{ key: 'k', name: 'K' }]);
    expect(heard).toBe(1);
  });

  it('saveSettings() announces the write', async () => {
    await saveSettings({ voice: 'v' });
    expect(heard).toBe(1);
  });

  it('wipe() announces, so an emptied library is backed up as empty', async () => {
    await savePhrases([{ id: 'a', text: 'Hallo', collections: [] }]);
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
    await savePhrases([{ id: 'a', text: 'Hallo', collections: [] }]);
    expect(heard).toBe(0);
  });
});
