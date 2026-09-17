import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, patchSettings, saveSettings } from '../../src/db/settings.ts';
import { saveAzure, saveOpen, savePen, saveRailOpen, saveVoice } from '../../src/db/repo.ts';
import { onChanged } from '../../src/db/db.ts';
import { wipe } from '../../src/db/wipe.ts';

/**
 * The settings record is written by presses, and presses arrive together.
 *
 * Every writer in repo.ts used to be a load, a merge in the caller and a put —
 * a read-modify-write across two transactions with an await in the middle. Two
 * calls in flight at once then commit in the order their *reads* resolved, and
 * that is not an ordering nobody can observe: it cost the voice picker a press
 * about one run in forty-eight (e2e/app.spec.ts, and item 4 of
 * docs/svelte-for-the-page.md). Every case here is about *concurrent* calls;
 * the sequential version of any of them passed before the fix too.
 *
 * Which of them had teeth against the old shape is worth writing down, because
 * it is not the one the flake was reported as. fake-indexeddb resolves those
 * two reads in the order they were asked for, every run, so the ordering cases
 * below passed before the fix as well — that half was only ever reachable from
 * a browser, and the e2e repeat is what measures it. **The sibling case failed
 * outright**, and deterministically: each call had read the record before the
 * other wrote it, so whichever put landed second put back a snapshot with the
 * other's field missing. Two preferences written together, one silently gone.
 * The ordering the flake was about and the loss below are the same defect, and
 * one transaction is the same fix for both.
 */
describe('patching the settings record', () => {
  beforeEach(async () => {
    await wipe();
  });

  const THORSTEN = 'de_DE-thorsten';
  const KERSTIN = 'de_DE-kerstin';

  it('stores the last value asked for, not the last read to resolve', async () => {
    await Promise.all([saveVoice(THORSTEN), saveVoice(KERSTIN)]);
    expect((await loadSettings()).voice).toBe(KERSTIN);
  });

  it('keeps the order under a burst, the way the picker is pressed', async () => {
    const pressed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    await Promise.all(pressed.map((voice) => saveVoice(voice)));
    expect((await loadSettings()).voice).toBe('h');
  });

  /* The half the chain in ui/voices.svelte.ts never covered, and the case that
     actually goes red without patchSettings: two *different* preferences
     written at once. Four of them here because the rail, the open Sammlungen
     and the voice genuinely do move together — restoring a session writes the
     first two within a frame of each other. */
  it('a field written at the same time as another does not drop it', async () => {
    await Promise.all([
      saveVoice(THORSTEN),
      saveRailOpen(false),
      saveOpen(['kueche']),
      savePen({ sheet: 'a4', next: 7 }),
    ]);
    expect(await loadSettings()).toEqual({
      voice: THORSTEN, railOpen: false, open: ['kueche'], pen: { sheet: 'a4', next: 7 },
    });
  });

  it('leaves everything it was not asked about alone', async () => {
    await saveSettings({ voice: THORSTEN, railOpen: true, keyScheme: 3 });
    await patchSettings({ railOpen: false });
    expect(await loadSettings()).toEqual({ voice: THORSTEN, railOpen: false, keyScheme: 3 });
  });

  /* Removing is a patch too, which is the whole of saveAzure: setting the key
     and forgetting it are one call, and a forgotten key has to be *gone* from
     the record rather than present and undefined — stripSecrets in db/backup.ts
     copies the fields it names, but nothing else here should have to know. */
  it('a field named with undefined goes, rather than being stored empty', async () => {
    await saveAzure({ key: 'sk-geheim-123', region: 'westeurope' });
    expect((await loadSettings()).azure).toEqual({ key: 'sk-geheim-123', region: 'westeurope' });

    await saveAzure(undefined);
    const now = await loadSettings();
    expect(now).toEqual({});
    expect(Object.keys(now)).not.toContain('azure');
  });

  it('announces once per call, whatever the patch touched', async () => {
    let heard = 0;
    const stop = onChanged(() => { heard++; });
    try {
      await patchSettings({ voice: THORSTEN, railOpen: true, open: ['kueche'] });
      expect(heard).toBe(1);
      await patchSettings({ voice: KERSTIN });
      expect(heard).toBe(2);
    } finally {
      stop();
    }
  });
});
