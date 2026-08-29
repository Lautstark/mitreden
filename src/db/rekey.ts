/**
 * Carrying a library across the day its recordings got a new name.
 *
 * The names have changed twice on 2026-08-29. core/ids.ts stopped assembling
 * CONTRACT.md §3 by hand and asked `@lautstark/stimmquelle` for it — same six
 * inputs, one corrected, §3.5 having been missing from every `azure:` name —
 * and then §3.4's engine term stopped saying `stimmquelle@<version>` and started
 * naming the pair that actually renders. Either way every fingerprint already
 * stored disagrees with what this page now computes. Left alone, the whole
 * library would read *geändert seit der Aufnahme* and the only way back would be
 * speaking all of it again: minutes of piper, or a bill from Azure, for audio
 * that is in fact perfectly current.
 *
 * It is current because nothing about the *sound* moved. No §1 rule, no §2
 * rule, no §3a rule; `PIPELINE_VERSION` is 3 across all of it. Only the
 * arithmetic that names the audio changed. So the honest repair is to rename,
 * not to re-record — which is the whole point of the second change, since
 * naming the package meant paying this cost on every release of it.
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
 * So the old formulas decide. `formerNames` says every name this sentence could
 * already be filed under; if the stored one is among them, the recording was
 * current and the new name is written. If it is not, the sentence was already
 * stale and is left exactly as it is — its stored name matches no scheme, so it
 * stays stale, which is what it was.
 */

import { allPhrases, loadSettings, putPhrases, saveSettings } from './db.ts';
import { fingerprint, formerNames } from '../core/ids.ts';
import type { Phrase } from '../core/types.ts';

/**
 * Which naming scheme the stored fingerprints are in.
 *
 * A number rather than a boolean, and it has already earned that: 2 was asking
 * stimmquelle for §3 instead of assembling it here, and 3 is naming the engine
 * that actually renders — piper-wasm and onnxruntime-web — rather than the
 * package that drives them, so that a stimmquelle release which changes no
 * audio stops re-recording the library.
 */
export const KEY_SCHEME = 3;

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
    // Several old names, because there have been two schemes before this one
    // and the first of them spelled the engine differently in each stimmquelle
    // release — see formerNames().
    if (!(await formerNames(item.text, item.voice)).includes(item.fingerprint)) continue;

    moved.push({ ...item, fingerprint: await fingerprint(item.text, item.voice) });
  }

  if (moved.length) await putPhrases(moved);
  // Last, and only once every sentence above is written: an interrupted run
  // leaves the mark unset and simply happens again, which is why the pass is
  // written to be idempotent rather than resumable.
  await saveSettings({ ...await loadSettings(), keyScheme: KEY_SCHEME });
  return moved.length;
}
