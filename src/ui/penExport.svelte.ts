/**
 * The question an Anybook export has to ask first.
 *
 * Three answers, and they lean on each other. Which sheet decides how many
 * circles there are; where to start decides how many are left; whether to print
 * a start code decides whether one of those is spent on it. A menu cannot hold
 * that, so it is a dialog.
 *
 * The one that is not obvious is the start. Label sheets are not used up in one
 * go — twenty come off for one Sammlung and sixty-eight are still perfectly
 * good — and an export that always begins at the first circle throws the rest
 * away. So the sheet is drawn, and the first free circle is clicked on it: the
 * paper is in the reader's hand while they answer, and looking at it beats
 * counting to nineteen.
 *
 * ## The shape this file is in
 *
 * The frame is @lautstark/design/dialog's, through ui/sheet.svelte.ts, and the
 * contents are two components mounted into the frame's own body and foot. What
 * is here is the state the three answers live in and the one function that
 * opens the thing — which is all this file ever was underneath the 150 lines of
 * `document.createElement` and `style.cssText` that drew it. `draw()` is gone
 * outright: the summary sentence, the grid and the sheet's own name all follow
 * the three fields because they read them.
 */

import { DEFAULT_SHEET, SHEETS, type Sheet } from '../core/anybook.ts';
import { loadSettings } from '../db/settings.ts';
import { openSheet } from './sheet.svelte.ts';
import { t } from './words.svelte.ts';
import PenExportBody from './PenExportBody.svelte';
import PenExportFoot from './PenExportFoot.svelte';

export interface PenChoice {
  sheet: Sheet;
  /** Whether a circle is spent on the activation code. */
  startCode: boolean;
  /** The first circle this run may use, 1-based. */
  start: number;
}

/** The three answers while they are being given, plus the one fact they are
 *  given against. The body and the foot share this object. */
export interface Choosing {
  sheet: Sheet;
  startCode: boolean;
  start: number;
  /** How many sentences want a circle. Read only to say how much room is
   *  needed; nothing here touches the recordings. */
  sentences: number;
  /** Filled by the foot when the export is confirmed, read by `onClose`. */
  answer: PenChoice | null;
}

/**
 * Asks, and resolves null if the reader closes it any other way.
 *
 * The promise settles from `onClose` alone, which is every way out at once —
 * the ✕, Escape, a press outside, Abbrechen, and the confirm, which closes the
 * sheet itself after writing its answer down.
 */
export async function askPenExport(sentences: number): Promise<PenChoice | null> {
  const remembered = (await loadSettings()).pen;
  const sheet = SHEETS[remembered?.sheet ?? DEFAULT_SHEET] ?? SHEETS[DEFAULT_SHEET]!;

  /* The suggestion, and its limits. It is where the last run ended, which is
     only where this one begins if that sheet was kept and printed — so it is
     offered and never assumed, and a sheet with no room left for it falls back
     to the top rather than opening on an impossible answer. */
  const start = remembered?.sheet === sheet.id && remembered.next > 1
    && remembered.next <= sheet.cols * sheet.rows ? remembered.next : 1;

  const s = $state<Choosing>({ sheet, startCode: true, start, sentences, answer: null });

  return new Promise<PenChoice | null>((done) => {
    openSheet({
      title: t('pen_ask_title'),
      state: s,
      body: PenExportBody,
      foot: PenExportFoot,
      /* $state.snapshot, because what leaves here is written to the database by
         savePen() and handed to penProject() — and a proxy is refused by
         structuredClone and by IndexedDB both. */
      onClose: () => done(s.answer ? $state.snapshot(s.answer) as PenChoice : null),
    });
  });
}
