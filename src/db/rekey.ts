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
 * ## And a third time, on 2026-10-02
 *
 * Taking stimmquelle 2.12.2 moved the names again, for `azure:` voices alone:
 * §3 now ends a cloud name with the output format and the SSML prosody rate,
 * because Azure renders from that rate and two rates are two recordings. The
 * package calls the cost "Azure names change once, and a cache of them
 * re-renders once" — true of vorlaut, where the name is a cache key. Here it
 * is not a cache key. It is what decides whether a sentence reads *geändert
 * seit der Aufnahme*, so the same release turned every Azure recording in the
 * library into a lie about itself: a library recorded in a cloud voice said it
 * had been changed since it was recorded, everywhere and all at once, with
 * nothing having been changed. Same cause, same repair, and the same argument
 * for renaming rather than re-recording — with a bill attached this time,
 * since re-recording a cloud library is money.
 *
 * A piper recording is untouched by that release and needs no carrying; the
 * pass walks it, finds its stored name under no former scheme, and leaves it.
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

import { allPhrases, patchPhrases, type PhrasePatch } from './phrases.ts';
import { loadSettings, patchSettings } from './settings.ts';
import { carriedName } from '../core/ids.ts';

/**
 * Which naming scheme the stored fingerprints are in.
 *
 * A number rather than a boolean, and it has already earned that three times:
 * 2 was asking stimmquelle for §3 instead of assembling it here, 3 is naming
 * the engine that actually renders — piper-wasm and onnxruntime-web — rather
 * than the package that drives them, so that a stimmquelle release which
 * changes no audio stops re-recording the library, and 4 is stimmquelle 2.12.2
 * putting what the cloud was asked for into an `azure:` name.
 *
 * A piper name is identical under 3 and 4, and a library with no cloud
 * recording in it is walked once and rewrites nothing. That is the cost of
 * having one number for the family of names rather than one per backend, and
 * it is a few hundred digests on a single boot.
 */
export const KEY_SCHEME = 4;

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
  /* The new name and only that, by id. The rows are read again inside the
     write's own transaction rather than put back from this copy: the digests
     below take a while, and a copy put back whole would put back whatever the
     copy held. A sentence edited in the meantime keeps its edit and gets a name
     that no longer matches it — stale, which is what it then is. */
  const moved = new Map<string, PhrasePatch>();

  /* One line, and the rule it asks is core/ids.ts's: only a recording whose
     stored name belongs to a former scheme is current, and only a current one
     may be renamed. It is written there rather than here because this is no
     longer the only caller — a pull from the folder asks the same question of
     every row arriving from another machine, and a rule that exists twice gets
     relaxed once. */
  for (const item of items) {
    const name = await carriedName(item.text, item.voice, item.fingerprint);
    if (name) moved.set(item.id, { fingerprint: name });
  }

  if (moved.size) await patchPhrases(moved);
  // Last, and only once every sentence above is written: an interrupted run
  // leaves the mark unset and simply happens again, which is why the pass is
  // written to be idempotent rather than resumable.
  await patchSettings({ keyScheme: KEY_SCHEME });
  return moved.size;
}
