/**
 * Typing a sentence, and which voice records it.
 *
 * Enter records; Shift + Enter is a new line. Several lines at once each become
 * their own sentence, because that is how a set of them gets written down.
 *
 * The voice is not chosen here. A picker beside the composer invited it to be
 * re-decided per sentence, which is not what it does. What is left is the
 * sentence: which voice is in force, and the way through to changing it.
 *
 * *Which* voice that is stopped being one answer when the voice moved onto the
 * Sammlung. In a Sammlung it is that Sammlung's; with none open or two, the
 * next sentence goes uncollected and it is the default. The line says which of
 * the two it read, because both are true statements about a voice and only one
 * of them is true here — see drawVoice.
 */

import { addPhrases, build, settings, saveVoice } from '../db/repo.ts';
import { asVoice, defaultVoice, offered } from '../core/voices.ts';
import { setProgress } from '../core/audio.ts';
import { LANGUAGES, lang, t, tn, type Lang } from '../i18n/index.ts';
import type { Voice } from '../core/types.ts';
import { DECLARED, OPEN, endWork, load, queueWork, stepWork, subscribe } from './state.ts';
import { busy, byId, say, sourceOf, speaks } from './dom.ts';

let voices: Voice[] = [];
let chosen = '';

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
 * sentence that is in none. Not "the voice the next recording gets" any more —
 * that question is answered by the Sammlung when there is one, and by this only
 * when there is not.
 */
export const chosenVoice = (): string => chosen;

/**
 * Which Sammlung the next sentence lands in — the one that is open, or none.
 *
 * add() below and the line above the composer have to agree about this or the
 * page names one voice and records in another, so they ask the same function
 * rather than repeating the rule. Two open Sammlungen answer *none*, on
 * purpose: guessing which of them was meant is worse than asking.
 */
export const nextCollection = (): string | undefined =>
  OPEN.size === 1 ? [...OPEN][0] : undefined;

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
export const knownVoices = (): readonly Voice[] => voices;
export const voiceById = (id: string): Voice | undefined =>
  voices.find((voice) => voice.id === id);

/** Whoever redraws a list of voices asks to hear about the one in force. */
const watchers: (() => void)[] = [];
export const onVoiceChange = (fn: () => void): void => { watchers.push(fn); };

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
  for (const code of Object.keys(LANGUAGES) as Lang[]) starts[code] = defaultVoice(list, code);
  // A voice somebody chose wins; then a stored one, which is how a choice
  // survives the key it needed going away and coming back; then whatever this
  // page had guessed until now.
  const wanted = (deliberate ? chosen : '') || saved.voice || chosen || '';
  const kept = voices.some((voice) => voice.id === wanted);
  chosen = kept ? wanted : starts[lang()] ?? '';
  deliberate = kept && (deliberate || wanted === saved.voice);
  drawVoice();
}

/**
 * The words changed, so the guess about which language to read aloud in has
 * too. A chosen voice is not a guess and does not move — including a chosen
 * German voice on an English page, which is somebody's arrangement and not a
 * mistake to correct.
 */
export function relangVoice(): void {
  const start = starts[lang()];
  if (!deliberate && start && start !== chosen) {
    chosen = start;
    for (const fn of watchers) fn();
  }
  // Unconditionally, and after the guard rather than inside it: the line says
  // *whose* voice it is naming, and those words change with the language even
  // on the pass where the voice itself does not move.
  drawVoice();
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
  drawVoice();
  for (const fn of watchers) fn();
  const picked = voiceById(id);
  if (picked) say(t('voice_now_default', { voice: picked.label }));
}

/**
 * What the next recording will sound like, in the three facts that decide it:
 * the voice's name, who renders it, and what it speaks. The last two were
 * missing, and a picker of forty names with nothing to tell them apart is a
 * list you scroll rather than choose from.
 *
 * And a fourth, added when the voice moved onto the Sammlung: *whose* voice
 * this is. The sentence was true before because there was one answer; there are
 * two now — this Sammlung's, or the default an uncollected sentence records in
 * — and a line naming a voice without saying which of the two it read is a line
 * that is right by luck.
 *
 * That fourth fact used to do double duty, as the caption that made one
 * „Ändern" button leading to two different places honest. The button is gone
 * (index.html says why) and the fact stays, because it was always the more
 * useful half: it answers "which voice is this" without anybody pressing
 * anything.
 */
function drawVoice(): void {
  const into = nextCollection();
  const voice = voiceById(voiceInForce());
  byId('voicewhat').textContent = t(into ? 'voice_label_collection' : 'voice_label_default');
  byId('voicename').textContent = voice?.label ?? '—';
  // The language, not the locale. "Englisch (Vereinigte Staaten)" is the honest
  // answer and it is also the one that pushed this line onto a row of its own;
  // the region only separates two voices when both are offered, which is a
  // question for the picker, where there is room to ask it.
  byId('voicefrom').textContent = voice ? `${sourceOf(voice.source)} · ${speaks(voice.lang)}` : '';
}

async function add(): Promise<void> {
  const box = byId<HTMLTextAreaElement>('t');
  const lines = box.value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    say(t('type_first'));
    return;
  }
  // A sentence goes into the Sammlung you are in. There is nothing to decide:
  // you opened one, you typed, it belongs there. With several open it goes in
  // uncollected — guessing which of two you meant would be worse than asking —
  // and an uncollected sentence records in the settings voice, which is the same
  // answer a Sammlung without one gets.
  const into = nextCollection();
  busy('busy_add');
  const { added, merged, ids } = await addPhrases(lines, into);
  box.value = '';
  // Show them before recording them. Waiting for the voice to exist before
  // drawing the row is how the list stays empty through a model download.
  // They are marked as being worked on before the draw, or every one of them
  // appears saying "noch nicht aufgenommen" — true, and the opposite of what
  // is happening to it.
  queueWork(ids);
  await load();
  if (!ids.length) { endWork(); return; }
  setProgress((percent) => busy('busy_model', { percent }));
  const { recorded, failed } = await build(ids, chosenVoice(), false, stepWork);
  setProgress(null);
  endWork();
  say(t('done_add', { added, rendered: recorded })
    + (merged ? t('done_add_twins', { n: merged }) : '') + '.'
    + (failed.length ? ` ${tn('not_recorded', failed.length, { why: failed[0]! })}` : ''));
  await load();
}

export function wireComposer(): void {
  /* The line is about where the next sentence lands, so it is redrawn whenever
     that moves — which is a rail click, a Sammlung deleted, a voice written
     onto the open one. It reads DECLARED() and OPEN, both of which this is the
     notification for. */
  subscribe(drawVoice);
  byId('add').onclick = () => void add();
  byId('t').addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.key === 'Enter' && !key.shiftKey) {
      event.preventDefault();
      void add();
    }
  });
}
