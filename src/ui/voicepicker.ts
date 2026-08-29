/**
 * The list of voices, and which of them a particular thing is set to.
 *
 * It was one list in one dialog and could be a module of module-level state.
 * There are two now — what this Sammlung records in, and what a new Sammlung
 * starts with — and they are different questions about the same catalogue, so
 * this is a component with its own state per instance rather than a pair of
 * copies that drift.
 *
 * Nothing here knows *whose* voice it is drawing. It is handed where to draw,
 * how to read the answer and what to do with a new one; everything else — the
 * narrowing, the four facts on a row, the radio semantics and the arrows — is
 * the same in both places because it is the same list.
 *
 * A shared instance would have been cheaper and wrong: `query` and `onlyLang`
 * are somebody's place in a list of hundreds, and carrying a search for
 * „kerstin" from one dialog into the other would look like the second one had
 * lost most of its voices.
 */

import { lang, t } from '../i18n/index.ts';
import type { Voice } from '../core/types.ts';
import { knownVoices } from './composer.ts';
import { el, sourceOf, speaks } from './dom.ts';
import { weighs } from '@lautstark/werkzeuge/bytes';

/**
 * stimmquelle publishes three, and a corpus of several speakers is `mixed`
 * rather than a guess. Anything it adds later is shown as it came, which is
 * honest, rather than as the name of a missing translation.
 */
const genderOf = (gender: string): string =>
  gender === 'female' || gender === 'male' || gender === 'mixed'
    ? t(`gender_${gender}`) : gender;

/** stimmquelle's rule: `de_DE`, `de-DE` and `de` all compare equal. */
const language = (code: string): string =>
  code.toLowerCase().replaceAll('_', '-').split('-')[0]!;

export interface PickerSpec {
  /** The search field, the language chips and the list, by id. */
  search: string;
  chips: string;
  list: string;
  /** What this list is choosing for, read at draw time rather than passed in:
   *  the Sammlung's sheet redraws for a different Sammlung. */
  current: () => string | undefined;
  pick: (id: string) => void;
}

export interface Picker {
  /** Redraw against whatever `current()` now answers. */
  draw(): void;
}

/**
 * Which voice records, chosen where it is decided rather than beside every
 * sentence. A shipped catalogue is forty-odd voices and an Azure key is
 * hundreds, so the list narrows by what you type and by what a voice speaks.
 *
 * It does not narrow by stimmquelle's `recommended`. That flag is editorial and
 * — as its own documentation says — always false for a cloud backend, which
 * publishes hundreds and about which the package has no opinion. So the moment
 * an Azure key is in, "only recommended" hides every Azure voice: a filter that
 * reads as though the key had stopped working.
 */
export function voicePicker(spec: PickerSpec): Picker {
  let query = '';
  let onlyLang: string | null = null;

  const matches = (voice: Voice): boolean => {
    if (onlyLang && language(voice.locale) !== onlyLang) return false;
    if (!query) return true;
    const hay = `${voice.label} ${voice.locale} ${sourceOf(voice.source)} ${speaks(voice.locale)}`;
    return hay.toLowerCase().includes(query);
  };

  /**
   * What a voice is, in the facts that decide between two of them: who renders
   * it, what it speaks, whose voice it is, and what it costs to have. The list
   * used to be a native select of bare names, where "Thorsten" and "Katja" were
   * indistinguishable in every way that matters — one is on this machine, the
   * other is a request to Microsoft per sentence.
   *
   * Four facts, and no verdict. stimmquelle's `recommended` used to be a badge
   * here, and it could not say what it meant: the flag is always false for a
   * cloud backend, so with an Azure key two rows carried it and hundreds did
   * not — and "we have no opinion" and "not as good" look identical from the
   * outside. The facts let somebody choose; the badge only looked like help.
   *
   * A row can carry one more line, and only when the catalogue puts it there.
   * `rushesFragments` is a trait of a model — one voice crams a word with no
   * terminal punctuation into a near-fixed span — and it is worth a sentence
   * here because this page is used on single words far more than on sentences.
   * The flag arrives wordless on purpose: stimmquelle states the fact, this page
   * says it in its own language and its own register, and neither has to know
   * about the other's. Which voices carry it is not this file's business, so no
   * voice is named in the code or in the words.
   */
  function voiceRow(voice: Voice, live: boolean): HTMLElement {
    const row = document.createElement('button');
    row.className = 'voice';
    row.type = 'button';
    row.dataset.id = voice.id;
    // A radio, not a pressed button. aria-pressed on a set where exactly one is
    // ever on describes toggles that happen to agree; this is one choice with
    // several answers, and a screen reader should say "3 of 17" rather than
    // leaving the reader to infer the exclusivity from the drawing.
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(live));
    // Roving tabindex: the list runs to hundreds with an Azure key, and tabbing
    // through it to reach the settings underneath is not a way out.
    row.tabIndex = live ? 0 : -1;

    const name = document.createElement('span');
    name.className = 'voice__name';
    name.textContent = voice.label;

    const facts = document.createElement('span');
    facts.className = 'voice__facts';
    // The download is the shipped voices' one real cost and the cloud ones'
    // is the key, so each says the one that applies to it and neither says both.
    facts.textContent = [
      sourceOf(voice.source),
      speaks(voice.locale),
      genderOf(voice.gender),
      voice.needsKey ? t('voice_needs_key') : voice.downloadBytes ? weighs(voice.downloadBytes) : '',
    ].filter(Boolean).join(' · ');

    row.append(name, facts);

    // A note, not a warning: the voice is fine for the sentences it was measured
    // on and cramped only on bare words, and it stays the right choice for
    // somebody who wants it. So it reads like the facts above it rather than
    // like an objection to the row it sits on — and it says what to do about it,
    // because typing "Hallo!" is a fix the person recording can actually apply.
    if (voice.rushesFragments) {
      const note = document.createElement('span');
      note.className = 'voice__hint';
      note.textContent = t('voice_rushes_fragments');
      row.append(note);
    }

    row.onclick = () => spec.pick(voice.id);
    return row;
  }

  /** One pill per language the catalogue actually offers, plus the way back. */
  function drawFilters(voices: readonly Voice[]): void {
    const box = el(spec.chips);
    box.innerHTML = '';
    const codes = [...new Set(voices.map((voice) => language(voice.locale)))]
      .sort((a, b) => speaks(a).localeCompare(speaks(b), lang()));

    const pill = (label: string, on: boolean, run: () => void): void => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = label;
      chip.setAttribute('aria-pressed', String(on));
      chip.onclick = () => { run(); draw(); };
      box.appendChild(chip);
    };

    pill(t('filter_any_language'), onlyLang === null, () => { onlyLang = null; });
    for (const code of codes)
      pill(speaks(code), onlyLang === code, () => { onlyLang = onlyLang === code ? null : code; });
  }

  function draw(): void {
    const voices = knownVoices();
    const live = spec.current();
    drawFilters(voices);

    const box = el(spec.list);
    box.innerHTML = '';
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', t('voice_pick_title'));
    const hits = voices.filter(matches);
    if (!hits.length) {
      const none = document.createElement('p');
      none.className = 'hint';
      none.textContent = t('voice_no_match');
      box.appendChild(none);
      return;
    }
    for (const voice of hits) box.appendChild(voiceRow(voice, voice.id === live));
    // Filtering can hide the chosen one, and a group where nothing is reachable
    // by Tab is a group the keyboard cannot enter at all.
    if (!box.querySelector('.voice[tabindex="0"]'))
      box.querySelector<HTMLElement>('.voice')?.setAttribute('tabindex', '0');
  }

  /** Arrow keys move the choice, as they do in any radio group. */
  function step(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const rows = [...el(spec.list).querySelectorAll<HTMLElement>('.voice')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || !rows.length) return;
    event.preventDefault();
    const to = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? (at + 1) % rows.length
          : (at - 1 + rows.length) % rows.length;
    const next = rows[to]!;
    next.focus();
    spec.pick(next.dataset.id ?? '');
  }

  const search = el<HTMLInputElement>(spec.search);
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    draw();
  });
  el(spec.list).addEventListener('keydown', (event) => step(event as KeyboardEvent));

  return { draw };
}
