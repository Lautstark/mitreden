/** What the program is about: sentences, the Sammlungen they sit in, voices. */

/** A recording either exists and matches the text, or it does not. */
export type State = 'ok' | 'stale' | 'missing';

export interface Phrase {
  /** Stable, derived from the text once. It is a filename on somebody's talker. */
  id: string;
  text: string;
  /** Keys, not names: a Sammlung can be renamed without touching its sentences. */
  collections: string[];
  voice?: string;
  /** Text and voice at the time of recording, so staleness is decidable. */
  fingerprint?: string;
}

export interface PhraseWithState extends Phrase {
  state: State;
}

export interface Collection {
  /** Minted once from the name; never re-derived. */
  key: string;
  name: string;
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
