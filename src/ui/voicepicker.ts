/**
 * The list of voices, and which of them a particular thing is set to.
 *
 * The list itself is `@lautstark/stimmquelle/voice-picker` since 2026-09-03 —
 * one module for the surface mitreden, vorlaut-editor and wochenwerk had each
 * drawn separately, with the same five class names and three different
 * drawings. Its header carries the measurement of all three and the argument
 * for every value that is not this file's any more.
 *
 * What is left here is the half that is mitreden's: which catalogue the list is
 * of, what language it is read in, where the block is built — and the reason
 * there are two of these rather than one.
 *
 * ## Two instances, and never one
 *
 * It was one list in one dialog and could have been a module of module-level
 * state. There are two now — what this Sammlung records in, and what a new
 * Sammlung starts with — and they are different questions about the same
 * catalogue, so each gets its own picker rather than a pair of copies that
 * drift.
 *
 * A shared instance would have been cheaper and wrong: the query and the
 * language filter are somebody's place in a list of hundreds, and carrying a
 * search for „kerstin" out of one dialog into the other would look like the
 * second one had lost most of its voices. The module holds that state per
 * `voicePicker()` call, which is why this is a function that builds one and
 * never a picker built here and exported: the shape is what keeps the rule,
 * rather than a note asking the next caller to remember it.
 *
 * Nothing here knows *whose* voice it is drawing. It is handed where to draw,
 * how to read the answer and what to do with a new one; everything else — the
 * narrowing, the four facts on a row, the radio semantics and the arrows — is
 * the same in both places because it is the same list.
 */

import { voicePicker as buildPicker, type VoicePicker } from '@lautstark/stimmquelle/voice-picker';
import { lang } from '../i18n/index.ts';
import { knownVoices } from './composer.ts';
import { byId } from './dom.ts';

export interface PickerSpec {
  /** The empty element the block is built into. */
  into: string;
  /** What this list is choosing for, read at draw time rather than passed in:
   *  the Sammlung's sheet redraws for a different Sammlung. */
  current: () => string | undefined;
  pick: (id: string) => void;
}

/**
 * One picker, built into the marker it is named for.
 *
 * `hear` is not passed: this page speaks a voice by recording with it, which is
 * minutes of synthesis and a file, and there is nothing here that plays a
 * sample. So no `▶` is drawn — the module draws the row wrapper either way, so
 * the day this page grows a sample player nothing else moves.
 *
 * `dispose` is not called, and that is a statement rather than an oversight:
 * both pickers are built once into dialogs that stay in the document for the
 * life of the page, and with no `hear` there is no download that could land on
 * a button nobody can see. The day either of those stops being true, the
 * handle this returns is what the caller disposes.
 */
export function voicePicker(spec: PickerSpec): VoicePicker {
  const picker = buildPicker({
    // Read on every paint rather than passed once: an Azure key saved in the
    // sheet the picker is standing in adds several hundred rows to it.
    voices: knownVoices,
    current: spec.current,
    pick: spec.pick,
    // A function, because this page changes language without reloading — the
    // language menu is two panels above this list. A locale captured at build
    // time would go on answering in the language the reader has just left.
    lang,
  });
  byId(spec.into).append(picker.node);
  return picker;
}
