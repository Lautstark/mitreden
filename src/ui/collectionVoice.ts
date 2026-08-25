/**
 * What one Sammlung records in, in the one place it can be said without
 * ambiguity: a sheet opened from the ⋯ beside its name.
 *
 * The voice moved onto the Sammlung (core/types.ts, `Collection.voice`) and the
 * screens went on offering it in Einstellungen, where the answer would have
 * changed with whichever Sammlung was open — which conventions.md §3.10 states
 * as the test rather than as a list: *a setting whose answer changes with the
 * selection is not the app's*. §3.6, amended the same day, is the other half:
 * the ⋯ holds what a Sammlung is set to as well as what can be done to it,
 * because both are answered by *which* Sammlung the menu is beside.
 *
 * ## Why this is a sheet and not a panel in one
 *
 * vorlaut's `docs/sammlung-settings.md` builds its equivalent as §3.5's column
 * of folded panels, one open at a time, because a talker Sammlung has two
 * things to set — the language its device shows its own menu in, and the voice.
 * mitreden has one. A column of one folded panel is a heading you have to open
 * to reach the only thing behind it, which is the arrangement §3.5 exists to
 * prevent rather than an instance of it. So the sheet is the panel: the lead
 * says whose voice this is, the list is open, and the cost sits under it.
 *
 * ## Live apply, and no confirmation
 *
 * Picking writes and closes nothing, the way vorlaut's sheet does — there is no
 * Save and no Cancel, because a voice destroys nothing. Every clip in the
 * Sammlung stays exactly where it is; what changes is that they no longer match
 * what the Sammlung says it sounds like, which `stateOf` in db/repo.ts reports
 * as *geändert seit der Aufnahme* and the ⋯'s own „neu aufnehmen" undoes by
 * speaking them again. A confirmation would be asking permission for something
 * reversible while saying nothing about what it costs; the line under the list
 * says what it costs, in sentences, before the press.
 */

import { saveCollectionVoice } from '../db/repo.ts';
import { t, tn } from '../i18n/index.ts';
import { chosenVoice, knownVoices } from './composer.ts';
import { voicePicker } from './voicepicker.ts';
import { DECLARED, load } from './state.ts';
import { el, say } from './dom.ts';

/** Which Sammlung the open sheet is about. The picker reads it on every draw,
 *  so this is the whole of what makes one dialog serve all of them. */
let showing: string | null = null;

const shown = () => DECLARED().find((one) => one.id === showing);

const picker = voicePicker({
  search: 'colvoiceq', chips: 'colvoicefilters', list: 'colvoices',
  /* The voice in force, which is not always the Sammlung's own. A Sammlung
     with no `voice` records in the default — from a migration, a restored
     backup written before the field existed, or a first run — and marking
     nothing in the list would have the sheet contradicting the line outside it,
     which names that same voice as the one recording. So the inherited answer
     is shown as the answer; pressing it is what makes it this Sammlung's own,
     which is a real change and not a no-op, because the default can move
     afterwards and this Sammlung will no longer follow it. */
  current: () => shown()?.voice ?? chosenVoice(),
  pick: (id) => void choose(id),
});

async function choose(id: string): Promise<void> {
  const current = shown();
  if (!current || !id || id === current.voice) return;
  await saveCollectionVoice(current.id, id);
  // The rows behind the sheet are what just changed — every one of them, from
  // recorded to changed-since — so this is a full reload rather than a redraw
  // of the list it was clicked in.
  await load();
  paint();
  const picked = knownVoices().find((one) => one.id === id);
  // The page's status line is inert behind a modal, so this is not heard now.
  // It is read when the sheet closes, which is where the reader is looking
  // next; the row's own aria-checked is what reports the press itself.
  if (picked) say(t('voice_now_collection', { name: current.name, voice: picked.label }));
}

/** The words around the list: whose voice, and what a different one costs. */
function paint(): void {
  const current = shown();
  if (!current) return;
  el('colvoicetitle').textContent = t('collection_voice_title');
  el('colvoicelead').textContent = t('collection_voice_lead', { name: current.name });
  // The count is the Sammlung's, not the open set's: this sheet is about one of
  // them however many are open beside it.
  el('colvoicecost').textContent = current.count
    ? tn('collection_voice_cost', current.count)
    : t('collection_voice_cost_empty');
  picker.draw();
}

export function openCollectionVoice(id: string): void {
  showing = id;
  paint();
  el<HTMLDialogElement>('colvoice').showModal();
}

export function wireCollectionVoice(): void {
  el('colvoiceclose').onclick = () => el<HTMLDialogElement>('colvoice').close();
}
