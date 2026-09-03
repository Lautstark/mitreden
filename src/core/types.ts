/** What the program is about: sentences, the Sammlungen they sit in, voices. */

import type { Quality } from '@lautstark/stimmquelle/browser';

/** A recording either exists and matches the text, or it does not. */
export type State = 'ok' | 'stale' | 'missing';

export interface Phrase {
  /** Stable, derived from the text once. It is a filename on somebody's talker. */
  id: string;
  text: string;
  /**
   * The one Sammlung it is in, by id rather than by name: a Sammlung can be
   * renamed without touching its sentences.
   *
   * One, not several. It used to be an array, because arity here was many —
   * conventions.md §4.1, which this overturns. The voice lives on the Sammlung
   * now (see Collection.voice), and a sentence in two of them would have two
   * answers to "which voice records this" and no way to choose between them.
   *
   * Absent is a real state and not an error: composer.ts puts a new sentence in
   * none when two Sammlungen are open, because guessing which was meant is
   * worse than asking. Such a sentence records in the settings voice.
   */
  collection?: string;
  /**
   * The voice it was actually recorded in. Written by build() and by nothing
   * else: it is a record of what happened, not a choice anybody makes here.
   * The choice is the Sammlung's.
   */
  voice?: string;
  /** Text and voice at the time of recording, so staleness is decidable. */
  fingerprint?: string;
}

export interface PhraseWithState extends Phrase {
  state: State;
}

export interface Collection {
  /**
   * A UUID, minted once, opaque, never derived from the name and never
   * re-derived — conventions.md §1.1.
   *
   * It used to be `normTag(name)`, which had to answer three questions a UUID
   * does not have: what happens when the name is edited, what happens when two
   * names reduce to the same key, and what happens when the reduction truncates
   * mid-word. The second of those was not hypothetical — see createCollection
   * in db/repo.ts, which silently handed back somebody else's Sammlung.
   */
  id: string;
  name: string;
  /**
   * Which voice its sentences are recorded in — the choice that used to be made
   * once for the whole page and written onto each sentence as it was recorded.
   *
   * Optional, and absent means the settings voice. A Sammlung is created with
   * whatever the settings hold (createCollection in db/repo.ts), so an absent
   * one is left over from a migration where no sentence had a voice to vote
   * with, from a restored backup written before this field existed, or from a
   * first run where nobody has picked a voice yet. All three want the same
   * answer, and the settings voice is it.
   *
   * Changing it makes the Sammlung's sentences stale, through the fingerprint
   * comparison in repo.ts: the fingerprint is taken over the text and the voice,
   * so feeding it a different voice is all it takes.
   */
  voice?: string;
}

export interface CollectionWithCount extends Collection {
  count: number;
}

export type Format = 'mp3' | 'wav';

/**
 * A voice as the page needs it: stimmquelle's `Offered` with the one thing it
 * cannot know — what to call this voice in a list where two of them share a
 * name. Everything else is carried through rather than re-derived, because the
 * picker has to say where a voice comes from and what it speaks, and both are
 * answers stimmquelle already holds.
 */
export interface Voice {
  id: string;
  label: string;
  /** The plain name, without the quality tier a twin forces into `label`. */
  name: string;
  /**
   * The model's tier, where the backend publishes one — absent for Azure and
   * for a system voice, neither of which names one.
   *
   * Carried rather than dropped because `label` is no longer the only thing
   * that asks: the picker is stimmquelle's now and works out the tier itself,
   * against whichever list it is drawing. Handing it `label` instead would fix
   * the ambiguity against a catalogue nobody is looking at, which is the thing
   * `labelOf`'s own documentation says not to do.
   */
  quality?: Quality;
  source: 'piper' | 'azure' | 'system';
  /** Two letters: `de`. */
  lang: string;
  /** `de_DE` for piper, `de-DE` for Azure — each as its own backend writes it. */
  locale: string;
  gender: string;
  /** Fetched before this voice first speaks. 0 for a cloud backend. */
  downloadBytes: number;
  needsKey: boolean;
  /**
   * True when this voice crams a word carrying no terminal punctuation into a
   * near-fixed span, so single words arrive as mush while sentences are fine.
   *
   * Optional and absent rather than false, exactly as the catalogue states it.
   * The fact belongs to a model, so stimmquelle owns which voices carry it and
   * this page owns the words: a second voice gaining the trait is a catalogue
   * release and no edit here. That is also why nothing in this repository may
   * name the voice it is currently true of.
   */
  rushesFragments?: boolean;
}
