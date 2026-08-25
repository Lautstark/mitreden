/**
 * Typing a sentence, and which voice records it.
 *
 * Enter records; Shift + Enter is a new line. Several lines at once each become
 * their own sentence, because that is how a set of them gets written down.
 *
 * The voice is no longer chosen here. It is a setting — one answer that holds
 * until it is changed — and a picker beside the composer invited it to be
 * re-decided per sentence, which is not what it does. What is left is the
 * sentence: which voice is in force, and the way through to changing it.
 */

import { addPhrases, build, settings, saveVoice } from '../db/repo.ts';
import { asVoice, defaultVoice, offered } from '../core/voices.ts';
import { setProgress } from '../core/audio.ts';
import { LANGUAGES, lang, t, tn, type Lang } from '../i18n/index.ts';
import type { Voice } from '../core/types.ts';
import { OPEN, endWork, load, queueWork, stepWork } from './state.ts';
import { busy, el, say, sourceOf, speaks } from './dom.ts';

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

export const chosenVoice = (): string => chosen;
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
  if (deliberate || !start || start === chosen) return;
  chosen = start;
  drawVoice();
  for (const fn of watchers) fn();
}

/** Picking a voice records nothing: it is the voice the next recording gets. */
export async function pickVoice(id: string): Promise<void> {
  if (!id || id === chosen) return;
  chosen = id;
  deliberate = true;
  await saveVoice(id);
  drawVoice();
  for (const fn of watchers) fn();
  const picked = voiceById(id);
  if (picked) say(t('voice_now', { voice: picked.label }));
}

/**
 * What the next recording will sound like, in the three facts that decide it:
 * the voice's name, who renders it, and what it speaks. The last two were
 * missing, and a picker of forty names with nothing to tell them apart is a
 * list you scroll rather than choose from.
 */
function drawVoice(): void {
  const voice = voiceById(chosen);
  el('voicename').textContent = voice?.label ?? '—';
  // The language, not the locale. "Englisch (Vereinigte Staaten)" is the honest
  // answer and it is also the one that pushed this line onto a row of its own;
  // the region only separates two voices when both are offered, which is a
  // question for the picker, where there is room to ask it.
  el('voicefrom').textContent = voice ? `${sourceOf(voice.source)} · ${speaks(voice.lang)}` : '';
}

async function add(): Promise<void> {
  const box = el<HTMLTextAreaElement>('t');
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
  const into = OPEN.size === 1 ? [...OPEN][0] : undefined;
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
  el('add').onclick = () => void add();
  el('t').addEventListener('keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.key === 'Enter' && !key.shiftKey) {
      event.preventDefault();
      void add();
    }
  });
}
