/**
 * Carrying a library across the day its recordings got a new name.
 *
 * core/ids.ts stopped assembling CONTRACT.md §3 by hand on 2026-08-29 and now
 * asks `@lautstark/stimmquelle` for it. Same six inputs, one of them corrected
 * — §3.5 was missing from every `azure:` name — but a different formula over
 * them, so every fingerprint already stored disagrees with what this page now
 * computes. Left alone, the whole library would read *geändert seit der
 * Aufnahme* and the only way back would be speaking all of it again: minutes of
 * piper, or a bill from Azure, for audio that is in fact perfectly current.
 *
 * It is current because nothing about the *sound* moved. No §1 rule, no §2
 * rule, no §3a rule; `PIPELINE_VERSION` is 3 on both sides of this change. Only
 * the arithmetic that names the audio changed. So the honest repair is to
 * rename, not to re-record.
 *
 * ## Why it is not a database migration
 *
 * db.ts says why in its own words: a versionchange transaction commits the
 * moment control reaches the event loop with no request outstanding, so one
 * await on a promise from elsewhere — *"a fetch, or `crypto.subtle.digest`"* —
 * leaves a half-migrated library behind. Naming a recording is exactly that
 * digest, four hundred times. So this runs after the database is open, as
 * ordinary reads and writes, and is safe to be interrupted: it re-keys one
 * sentence at a time and the mark is only set once every one of them is done.
 *
 * ## What it must not do
 *
 * **Silently freshen a sentence that was already stale.** A phrase whose text
 * was edited after it was recorded carries a fingerprint that no longer matches
 * its own text, and that mismatch is a true statement about it: the clip says
 * something else. Recomputing from the current text would erase that and leave
 * audio nobody can tell is wrong.
 *
 * So the old formula decides. `formerFingerprint` says what this sentence's name
 * *was* under the scheme that wrote it; if the stored name matches, the
 * recording was current and the new name is written. If it does not, the
 * sentence was already stale and is left exactly as it is — its stored name
 * matches neither scheme, so it stays stale, which is what it was.
 */

import { allPhrases, loadSettings, putPhrases, saveSettings } from './db.ts';
import { fingerprint, formerFingerprint } from '../core/ids.ts';
import type { Phrase } from '../core/types.ts';

/**
 * Which naming scheme the stored fingerprints are in.
 *
 * A number rather than a boolean because this will happen again: §3 is stable
 * but the truncation, the `out` term and the engine term are all things a
 * product may yet reconsider, and each would want the same pass with a
 * different pair of formulas.
 */
export const KEY_SCHEME = 2;

/**
 * Renames every recording that is still current, and reports how many.
 *
 * Returns the number rewritten, which is nought on every run after the first
 * and on a library that has never recorded anything.
 */
export async function rekeyIfNeeded(): Promise<number> {
  const settings = await loadSettings();
  if (settings.keyScheme === KEY_SCHEME) return 0;

  const items = await allPhrases();
  const moved: Phrase[] = [];

  for (const item of items) {
    // Nothing to carry: a sentence that has never been recorded has no name to
    // change, and one recorded before the voice was stored cannot be checked
    // against either formula — repo.ts's stateOf already calls that stale.
    if (!item.fingerprint || !item.voice) continue;

    // The load-bearing line. Only a recording whose old name still matches its
    // own text and voice is current, and only a current one may be renamed.
    if (await formerFingerprint(item.text, item.voice) !== item.fingerprint) continue;

    moved.push({ ...item, fingerprint: await fingerprint(item.text, item.voice) });
  }

  if (moved.length) await putPhrases(moved);
  // Last, and only once every sentence above is written: an interrupted run
  // leaves the mark unset and simply happens again, which is why the pass is
  // written to be idempotent rather than resumable.
  await saveSettings({ ...await loadSettings(), keyScheme: KEY_SCHEME });
  return moved.length;
}
