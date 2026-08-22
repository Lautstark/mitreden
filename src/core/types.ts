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

export interface Voice {
  id: string;
  label: string;
  backend: 'piper' | 'azure';
  active?: boolean;
}
