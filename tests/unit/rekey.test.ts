import { beforeEach, describe, expect, it } from 'vitest';
import { allPhrases, loadSettings, putPhrases, saveSettings, wipe } from '../../src/db/db.ts';
import { KEY_SCHEME, rekeyIfNeeded } from '../../src/db/rekey.ts';
import { fingerprint, formerFingerprint } from '../../src/core/ids.ts';

/**
 * Carrying a library across the day its recordings got a new name.
 *
 * core/ids.ts stopped assembling CONTRACT.md §3 by hand and now asks
 * `@lautstark/stimmquelle` for it — same inputs, one of them corrected, a
 * different formula. Every stored fingerprint therefore disagrees with what
 * the page now computes, and the whole library would read *geändert seit der
 * Aufnahme* unless something renamed it.
 *
 * Two claims, and the second is the one worth having a file for. Renaming what
 * is current is the feature; **not** renaming what was already stale is what
 * makes it safe, because a sentence edited after it was recorded carries a
 * fingerprint that no longer matches its own text, and that mismatch is a true
 * statement about it. Recomputing blindly would erase it and leave audio
 * nobody can tell is wrong.
 */

const VOICE = 'piper:de_DE-thorsten-medium';
const CLOUD = 'azure:de-DE-KatjaNeural';

// One database per module instance under fake-indexeddb, so each test starts
// from an emptied one rather than a fresh handle.
beforeEach(async () => { await wipe(); });

/** A sentence as the old scheme left it: recorded, and named by that scheme. */
async function recorded(id: string, text: string, voice: string): Promise<void> {
  await putPhrases([{ id, text, voice, fingerprint: await formerFingerprint(text, voice) }]);
}

describe('the pass', () => {
  it('renames a recording that is still current', async () => {
    await recorded('hunger', 'Ich habe Hunger.', VOICE);

    expect(await rekeyIfNeeded()).toBe(1);

    const [item] = await allPhrases();
    expect(item!.fingerprint).toBe(await fingerprint('Ich habe Hunger.', VOICE));
  });

  it('renames a cloud recording too — the clause that was missing', async () => {
    // §3.5, the pipeline version, was absent from every azure: name under the
    // old scheme. These are exactly the recordings whose names were wrong, and
    // they are carried across rather than re-spoken, because no §1 or §2 rule
    // moved in the release that fixed the formula.
    await recorded('durst', 'Ich habe Durst.', CLOUD);

    expect(await rekeyIfNeeded()).toBe(1);

    const [item] = await allPhrases();
    expect(item!.fingerprint).toBe(await fingerprint('Ich habe Durst.', CLOUD));
  });

  it('leaves a sentence that was already stale exactly as it was', async () => {
    // The load-bearing case. Recorded, then the text edited and not spoken
    // again: the stored name matches neither its own text under the old scheme
    // nor anything under the new one, and it must go on matching neither.
    await recorded('bett', 'Ich will ins Bett.', VOICE);
    const [before] = await allPhrases();
    await putPhrases([{ ...before!, text: 'Ich will noch nicht ins Bett.' }]);

    expect(await rekeyIfNeeded()).toBe(0);

    const [after] = await allPhrases();
    expect(after!.fingerprint).toBe(before!.fingerprint);
    // And it is still stale under the scheme now in force, which is the point:
    // the clip says something other than what the sentence says.
    expect(after!.fingerprint)
      .not.toBe(await fingerprint('Ich will noch nicht ins Bett.', VOICE));
  });

  it('skips a sentence that was never recorded', async () => {
    await putPhrases([{ id: 'neu', text: 'Ganz neu.' }]);

    expect(await rekeyIfNeeded()).toBe(0);

    const [item] = await allPhrases();
    expect(item!.fingerprint).toBeUndefined();
  });

  it('skips one recorded before the voice was stored', async () => {
    // repo.ts's stateOf already calls a fingerprint without a voice stale, and
    // neither formula can be evaluated without one.
    await putPhrases([{ id: 'alt', text: 'Von früher.', fingerprint: 'abcdef123456' }]);

    expect(await rekeyIfNeeded()).toBe(0);
    expect((await allPhrases())[0]!.fingerprint).toBe('abcdef123456');
  });
});

describe('the mark', () => {
  it('is set afterwards, so the pass does not run twice', async () => {
    await recorded('hunger', 'Ich habe Hunger.', VOICE);

    expect(await rekeyIfNeeded()).toBe(1);
    expect((await loadSettings()).keyScheme).toBe(KEY_SCHEME);
    // Second run: nothing left to do, and nothing touched. Without the mark
    // this would be harmless anyway — a renamed recording no longer matches
    // the old formula — which is what makes an interrupted run safe to repeat.
    expect(await rekeyIfNeeded()).toBe(0);
  });

  it('is set on a library with nothing recorded in it', async () => {
    // Otherwise every boot of an empty page walks every sentence forever.
    expect(await rekeyIfNeeded()).toBe(0);
    expect((await loadSettings()).keyScheme).toBe(KEY_SCHEME);
  });

  it('keeps the rest of the settings', async () => {
    await saveSettings({ voice: VOICE, railOpen: false });

    await rekeyIfNeeded();

    const settings = await loadSettings();
    expect(settings.voice).toBe(VOICE);
    expect(settings.railOpen).toBe(false);
  });
});
