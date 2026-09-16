/**
 * The catalogue, and which voice is in force.
 *
 * This is composer.ts's other half. The typing and the line beside it are
 * Compose.svelte now; what stayed is the part that is not markup — which voices
 * this browser can speak in, which of them is the default, and the rule that
 * decides what the next recording actually gets.
 *
 * The voice is not chosen here and never was. A picker beside the composer
 * invited it to be re-decided per sentence, which is not what it does. *Which*
 * voice is in force stopped being one answer when the voice moved onto the
 * Sammlung: in a Sammlung it is that Sammlung's; with none open or two, the
 * next sentence goes uncollected and it is the default.
 *
 * `onVoiceChange` is gone with the rest of the watcher lists — a component that
 * reads `chosenVoice()` while it draws is drawn again when it moves.
 */

import { settings, saveVoice } from '../db/repo.ts';
import { asVoice, defaultVoice, offered } from '../core/voices.ts';
import { LANGS, type Lang } from '../i18n/index.ts';
import { lang, t } from './words.svelte.ts';
import { say } from './dom.ts';
import type { Voice } from '../core/types.ts';
import { DECLARED, OPEN } from './store.svelte.ts';

let voices = $state.raw<readonly Voice[]>([]);
let chosen = $state('');

/**
 * Whether the voice in force is somebody's answer or the page's guess. Only a
 * guess may be revisited: the language changing says something about what to
 * read aloud, but it says nothing about a voice that was chosen on purpose.
 */
let deliberate = false;

/**
 * Where each language starts, worked out when the catalogue is. Changing the
 * words must not cost an Azure request, and Azure's answer would be the same
 * one anyway.
 */
let starts: Partial<Record<Lang, string>> = {};

/**
 * The default voice: what a new Sammlung is made with, and what records a
 * sentence that is in none. Not "the voice the next recording gets" — that
 * question is answered by the Sammlung when there is one, and by this only when
 * there is not.
 */
export const chosenVoice = (): string => chosen;

export const knownVoices = (): readonly Voice[] => voices;
export const voiceById = (id: string): Voice | undefined =>
  voices.find((voice) => voice.id === id);

/**
 * Which Sammlung the next sentence lands in — the one that is open, or none.
 *
 * The composer and the line above it have to agree about this or the page names
 * one voice and records in another, so they ask this rather than each repeating
 * the rule. Two open Sammlungen answer *none*, on purpose: guessing which of
 * them was meant is worse than asking.
 */
export const nextCollection = (): string | undefined => {
  const open = OPEN();
  return open.size === 1 ? [...open][0] : undefined;
};

/**
 * The voice the next recording actually gets, which is the sentence the line
 * beside the composer states.
 *
 * The same rule as voiceFor() in db/repo.ts, read off what the page already has
 * in memory rather than out of the store: the Sammlung's voice, or the default
 * when it has none or there is no Sammlung. The two must not be allowed to
 * disagree — one decides what is said and the other what is recorded.
 */
export const voiceInForce = (): string => {
  const into = nextCollection();
  const held = into ? DECLARED().find((one) => one.id === into)?.voice : undefined;
  return held ?? chosen;
};

/**
 * The catalogue, and which of it is in force. A stored voice that is no longer
 * offered — an Azure one after the key went — must not stay the answer: the
 * next recording would fail rather than quietly use a shipped voice.
 */
export async function loadVoices(): Promise<void> {
  const saved = await settings();
  const list = await offered(saved.azure);
  voices = list.map((voice) => asVoice(voice, list));
  starts = {};
  for (const code of LANGS) starts[code] = defaultVoice(list, code);
  // A voice somebody chose wins; then a stored one, which is how a choice
  // survives the key it needed going away and coming back; then whatever this
  // page had guessed until now.
  const wanted = (deliberate ? chosen : '') || saved.voice || chosen || '';
  const kept = voices.some((voice) => voice.id === wanted);
  chosen = kept ? wanted : starts[lang()] ?? '';
  deliberate = kept && (deliberate || wanted === saved.voice);
}

/**
 * The words changed, so the guess about which language to read aloud in has
 * too. A chosen voice is not a guess and does not move — including a chosen
 * German voice on an English page, which is somebody's arrangement and not a
 * mistake to correct.
 *
 * What it no longer does is redraw anything. The line beside the composer and
 * the heading over the picker both read `chosenVoice()` while they draw, so
 * moving it is the whole of the change; the words around it follow the language
 * rune in words.svelte.ts on the same pass.
 */
export function relangVoice(): void {
  const start = starts[lang()];
  if (!deliberate && start && start !== chosen) chosen = start;
}

/**
 * Picking the default. It records nothing and reaches into no Sammlung that
 * already exists — createCollection copies it in at creation and nothing else
 * reads it except a Sammlung that never got one, and a sentence in none.
 */
export async function pickVoice(id: string): Promise<void> {
  if (!id || id === chosen) return;
  chosen = id;
  deliberate = true;
  await saveVoice(id);
  const picked = voiceById(id);
  if (picked) say(t('voice_now_default', { voice: picked.label }));
}
