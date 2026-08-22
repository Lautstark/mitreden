/**
 * Typing a sentence, and which voice records it.
 *
 * Enter records; Shift + Enter is a new line. Several lines at once each become
 * their own sentence, because that is how a set of them gets written down.
 */

import { addPhrases, build, settings, saveVoice } from '../db/repo.ts';
import { asVoice, offered } from '../core/voices.ts';
import { setProgress } from '../core/audio.ts';
import { t, tn } from '../i18n/index.ts';
import type { Voice } from '../core/types.ts';
import { OPEN, load } from './state.ts';
import { el, say } from './dom.ts';

let voices: Voice[] = [];

export const chosenVoice = (): string => el<HTMLSelectElement>('voice').value;

export async function loadVoices(): Promise<void> {
  const saved = await settings();
  const list = await offered(saved.azure);
  voices = list.map((voice) => asVoice(voice, list));
  const select = el<HTMLSelectElement>('voice');
  const keep = select.value || saved.voice;
  select.innerHTML = '';
  select.disabled = voices.length === 0;
  if (!voices.length) {
    select.appendChild(new Option('—', ''));
    return;
  }
  for (const voice of voices) {
    const option = new Option(voice.label, voice.id);
    if (voice.id === keep) option.selected = true;
    select.appendChild(option);
  }
}

/** Picking a voice records nothing: it is the voice the next recording gets. */
async function pickVoice(): Promise<void> {
  const id = chosenVoice();
  if (!id) return;
  await saveVoice(id);
  const picked = voices.find((voice) => voice.id === id);
  if (picked) say(t('voice_now', { voice: picked.label }));
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
  el('voice').addEventListener('change', () => void pickVoice());
}
