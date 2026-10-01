import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A saved voice the page can no longer record in does not stand in for
 * anything until it can again.
 *
 * The case is an Azure voice chosen as the default, and then the key
 * forgotten. ui/voices.svelte.ts keeps the saved choice — it comes back with
 * the key — and puts a shipped voice in force on the page meanwhile. The store
 * did not follow: build() recorded every sentence without a Sammlung voice in
 * the saved Azure one and failed each with "no azure key", and a Sammlung made
 * in that state was born holding the voice nobody could reach.
 *
 * The recorder is stood in for: what is asserted is which voice it was asked
 * for, and a real one would download a model to answer.
 */
const asked: string[] = [];
vi.mock('../../src/core/audio.ts', async (original) => ({
  ...(await original<object>()),
  record: async (_text: string, voice: string, azure?: unknown) => {
    asked.push(voice);
    if (voice.startsWith('azure:') && !azure) throw new Error('no azure key');
    return { blob: new Blob(['x']) };
  },
}));

const { addPhrases, build, createCollection, saveAzure, saveVoice } = await import('../../src/db/repo.ts');
const { loadSettings } = await import('../../src/db/settings.ts');
const { wipe } = await import('../../src/db/wipe.ts');

const KATJA = 'azure:de-DE-KatjaNeural';
const THORSTEN = 'piper:de_DE-thorsten-medium';

describe('the saved voice, once its key is gone', () => {
  beforeEach(async () => {
    await wipe();
    asked.length = 0;
    await saveAzure({ key: 'k', region: 'westeurope' });
    await saveVoice(KATJA);
    await saveAzure(undefined);
  });

  it('records a sentence in no Sammlung in the voice the page offers', async () => {
    const { ids } = await addPhrases(['Hallo.']);

    const out = await build(ids, THORSTEN);

    expect(out.failed).toEqual([]);
    expect(asked).toEqual([THORSTEN]);
  });

  it('is not handed to a new Sammlung, which follows the default instead', async () => {
    const made = await createCollection('Morgens', true);
    expect(made.voice).toBeUndefined();
  });

  it('stays saved, so it is the answer again when the key is back', async () => {
    expect((await loadSettings()).voice).toBe(KATJA);

    await saveAzure({ key: 'k', region: 'westeurope' });
    const made = await createCollection('Abends', true);
    expect(made.voice).toBe(KATJA);
  });
});
