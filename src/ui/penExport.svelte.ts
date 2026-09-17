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
 * The frame is @lautstark/design/svelte/sheet's `openSheet`, and the contents
 * are two components mounted into the frame's own body and foot. What is here
 * is the state the three answers live in and the one function that opens the
 * thing — which is all this file ever was underneath the 150 lines of
 * `document.createElement` and `style.cssText` that drew it. `draw()` is gone
 * outright: the summary sentence, the grid and the sheet's own name all follow
 * the three fields because they read them.
 *
 * ui/sheet.svelte.ts stood between this file and the package and is gone: it
 * was this product's copy of the arrangement conventions.md §6.1 now ships,
 * and its one caller is here.
 */

import { openSheet } from '@lautstark/design/svelte/sheet';
import { DEFAULT_SHEET, SHEETS, type Sheet } from '../core/anybook.ts';
import { loadSettings } from '../db/settings.ts';
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
  /**
   * The answer, given by the press that gave it, and only the first one counts.
   *
   * This replaces a `answer: PenChoice | null` field that the foot wrote and
   * `onClose` read. See `askPenExport` for why that had to go; what matters
   * here is that a foot button says what it decided rather than leaving a note
   * for whatever runs next.
   */
  settle(choice: PenChoice | null): void;
}

/**
 * Asks, and resolves null if the reader closes it any other way.
 *
 * ## It no longer settles from `close` alone, and that was a real bug
 *
 * It used to: the foot wrote its answer onto the shared state, closed the
 * sheet, and `onClose` resolved the promise with whatever it found there. Two
 * comments in this file argued for that as "one exit for every way out", and
 * conventions.md §3.4 spells out why it is the wrong one — a promise resolved
 * from `close` alone "hangs forever on any host that closes the dialog without
 * firing it", and the caller then waits for the life of the page while the
 * person looks at a button that did nothing. There is no failing assertion in
 * a promise that stays pending, which is why it read as working.
 *
 * §3.4's shape, and `confirmDialog`'s: the two footer presses settle it
 * themselves, `onClose` settles it null for the dismissal paths — the ✕,
 * Escape, a press outside — and a `settled` guard means whichever arrives
 * first is the answer. §6.1 recorded this file as the one place in the family
 * diverging from §3.4; it no longer is.
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

  /* Replaced on the next line, before anything can reach it: the promise is
     what owns the guard, and `openSheet` is not called until it does. A field
     rather than a closure threaded through two components because `s` is the
     only thing the frame hands them (§6.1's `SheetContent`). */
  const s = $state<Choosing>({ sheet, startCode: true, start, sentences, settle: () => {} });

  return new Promise<PenChoice | null>((done) => {
    let settled = false;
    s.settle = (choice: PenChoice | null): void => {
      if (settled) return;
      settled = true;
      /* $state.snapshot, because what leaves here is written to the database by
         savePen() and handed to penProject() — and a proxy is refused by
         structuredClone and by IndexedDB both. The foot builds the object out
         of `s`, so `sheet` on it is still one. */
      done(choice ? $state.snapshot(choice) as PenChoice : null);
    };

    openSheet({
      title: t('pen_ask_title'),
      /* Per call, like ui/dialog.ts's: this page changes language without
         reloading and a label captured at module scope would be the previous
         one. A sheet opened now is named in the language showing now. */
      closeLabel: t('close'),
      state: s,
      body: PenExportBody,
      foot: PenExportFoot,
      /* The dismissal paths only. The two presses in the foot have already
         settled it by the time this runs, and the guard is what makes that
         true rather than hoped for. */
      onClose: () => s.settle(null),
    });
  });
}
