import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropCollection, getCollection, patchCollection, putCollection,
} from '../../src/db/collections.ts';
import { dropPhrase, getPhrase, patchPhrase, putPhrases } from '../../src/db/phrases.ts';
import { loadSettings } from '../../src/db/settings.ts';
import { wipe } from '../../src/db/wipe.ts';
import {
  createCollection, editPhrase, renameCollection, saveCollectionVoice, saveSidebarOpen,
  saveVoice,
} from '../../src/db/repo.ts';

/**
 * Two writes to one record, a moment apart, both land.
 *
 * Every writer that changes one field of a stored record used to be a read, a
 * merge in JavaScript and a put — three awaits where IndexedDB offers one
 * transaction. Two of them in flight at once each read the record before the
 * other had written it, so whichever put landed second put back a snapshot with
 * the other's field as it was. Nothing failed; one edit was simply gone.
 *
 * The settings record met this first (tests/unit/settings-patch.test.ts is the
 * detailed account, and the case below only holds the line). The Sammlung and
 * the sentence had the same shape under `renameCollection`,
 * `saveCollectionVoice`, `editPhrase` and the save at the end of every
 * recording in `build()`, and this file is what those go red against: each
 * case fires two writers at one record without awaiting between them and asks
 * for both fields afterwards.
 *
 * fake-indexeddb resolves requests in the order they were made, every run, so
 * what these cases pin is the deterministic half — the *loss*. The ordering
 * half, where the later read overwrites the earlier write, is the same defect
 * seen from a browser, and the same one transaction closes both.
 */

const THORSTEN = 'piper:de_DE-thorsten-medium';
const KERSTIN = 'piper:de_DE-kerstin-low';

beforeEach(() => wipe());

describe('the settings record', () => {
  it('keeps both of two preferences written in the same moment', async () => {
    await Promise.all([saveVoice(THORSTEN), saveSidebarOpen(false)]);
    expect(await loadSettings()).toEqual({ voice: THORSTEN, sidebarOpen: false });
  });
});

describe('a Sammlung', () => {
  it('keeps both a new name and a new voice written in the same moment', async () => {
    const { id } = await createCollection('Küche', true);

    await Promise.all([renameCollection(id, 'Die Küche'), saveCollectionVoice(id, KERSTIN)]);

    expect(await getCollection(id)).toEqual({ id, name: 'Die Küche', voice: KERSTIN });
  });

  it('keeps the voice set while the name was being set, whichever was asked first', async () => {
    const { id } = await createCollection('Küche', true);

    await Promise.all([saveCollectionVoice(id, KERSTIN), renameCollection(id, 'Die Küche')]);

    expect(await getCollection(id)).toEqual({ id, name: 'Die Küche', voice: KERSTIN });
  });

  /* The rule the three patch writers share: a field named with undefined goes,
     rather than being stored empty. For a Sammlung that is how its voice is
     handed back to the default. */
  it('gives its voice back to the default when the patch names it undefined', async () => {
    const { id } = await createCollection('Küche', true, KERSTIN);
    await patchCollection(id, { voice: undefined });
    const held = await getCollection(id);
    expect(held).toEqual({ id, name: 'Küche' });
    expect(Object.keys(held!)).not.toContain('voice');
  });
});

describe('a sentence', () => {
  beforeEach(async () => {
    await putCollection({ id: 'kueche', name: 'Küche' });
    await putPhrases([{ id: 'hunger', text: 'Ich habe Hunger.', collection: 'kueche' }]);
  });

  /* The Sammlung going strips the membership inside its own transaction; an
     edit of the sentence's text landing beside it must not put the membership
     back — which is exactly what a put of a record read a moment earlier did. */
  it('is edited and leaves its Sammlung in the same moment, and both hold', async () => {
    await Promise.all([editPhrase('hunger', 'Ich möchte etwas essen.'), dropCollection('kueche')]);

    const held = await getPhrase('hunger');
    expect(held?.text).toBe('Ich möchte etwas essen.');
    expect(held?.collection, 'the membership the Sammlung took with it stays gone')
      .toBeUndefined();
  });

  /* The save at the end of a recording, beside an edit of the text. build()
     reads the library once and used to put each sentence back whole after its
     recording — a copy that could be minutes old by then — and the text
     corrected in the meantime went with it. It writes the two fields it means
     now, through patchPhrase, and this is that write beside an edit. */
  it('keeps a corrected text and the recording that landed beside it', async () => {
    await Promise.all([
      editPhrase('hunger', 'Ich möchte etwas essen.'),
      patchPhrase('hunger', { voice: THORSTEN, fingerprint: 'abc123def456' }),
    ]);

    expect(await getPhrase('hunger')).toMatchObject({
      text: 'Ich möchte etwas essen.', voice: THORSTEN, fingerprint: 'abc123def456',
      collection: 'kueche',
    });
  });

  /* The other thing a put of an old copy did: a sentence deleted while its
     recording was being made came back when the recording was saved. */
  it('does not come back when a recording lands on it after it was deleted', async () => {
    const [, saved] = await Promise.all([
      dropPhrase('hunger'),
      patchPhrase('hunger', { voice: THORSTEN, fingerprint: 'abc123def456' }),
    ]);

    expect(saved, 'the write says it found nothing').toBeNull();
    expect(await getPhrase('hunger')).toBeUndefined();
  });
});
