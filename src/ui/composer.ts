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
import { asVoice, offered } from '../core/voices.ts';
import { setProgress } from '../core/audio.ts';
import { t, tn } from '../i18n/index.ts';
import type { Voice } from '../core/types.ts';
import { OPEN, load } from './state.ts';
import { el, say, sourceOf, speaks } from './dom.ts';

let voices: Voice[] = [];
let chosen = '';

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
  const wanted = chosen || saved.voice || '';
  chosen = voices.some((voice) => voice.id === wanted) ? wanted : voices[0]?.id ?? '';
  drawVoice();
}

/** Picking a voice records nothing: it is the voice the next recording gets. */
export async function pickVoice(id: string): Promise<void> {
  if (!id || id === chosen) return;
  chosen = id;
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
  el('voicefrom').textContent = voice ? `${sourceOf(voice.source)} · ${speaks(voice.locale)}` : '';
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
  // uncollected — guessing which of two you meant would be worse than asking.
  const into = OPEN.size === 1 ? [...OPEN] : [];
  say(t('busy_add'));
  const { added, merged, ids } = await addPhrases(lines, into);
  box.value = '';
  // Show them before recording them. Waiting for the voice to exist before
  // drawing the row is how the list stays empty through a model download.
  await load();
  if (!ids.length) return;
  setProgress((percent) => say(t('busy_model', { percent })));
  const { recorded, failed } = await build(ids, chosenVoice());
  setProgress(null);
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
