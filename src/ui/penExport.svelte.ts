/**
 * The question an Anybook export has to ask first.
 *
 * Three answers, and they lean on each other. Which sheet decides how many
 * circles there are; where to start decides how many are left; whether to print
 * a start code decides whether one of those is spent on it. A menu cannot hold
 * that, so it is a dialog.
 *
 * ## And a fourth, asked on its own panel
 *
 * How many stickers each sentence gets. A Klettspiel has thirty cards made of
 * ten words, and mitreden holds each word once — so the repetition is a number
 * beside the sentence rather than the sentence nine times over (Phrase.copies).
 * It is asked here because here is the only place it is asked: the sentence
 * list says nothing about it, which is the point. A print is the only thing
 * that count is for.
 *
 * It is a second panel rather than a fourth field. The first three are about a
 * sheet of paper somebody is holding; this one is about a game on the floor,
 * and it is a row per sentence.
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
  /**
   * How many stickers each sentence gets, by id, as the dialog was left.
   *
   * Every sentence is in here, the ones at one included, because the caller
   * writes these back onto the sentences — see Phrase.copies — and a sentence
   * turned back down to one has to be able to lose the number it had.
   */
  copies: Map<string, number>;
}

/** One sentence as the counting step shows it. */
export interface PenItem {
  id: string;
  /** What the row says, and what is printed under its circles. */
  text: string;
  /** What the sentence holds now, or one. At least one, always: the list is of
   *  sentences that are getting stickers. */
  copies: number;
}

/** The answers while they are being given, plus the one fact they are given
 *  against. The body and the foot share this object. */
export interface Choosing {
  sheet: Sheet;
  startCode: boolean;
  start: number;
  /**
   * The sentences and their counts, editable.
   *
   * It used to be `sentences: number` — how many circles were wanted, which
   * was the sentence count because every sentence got exactly one. A sentence
   * can want several now, so the thing the geometry is computed against is
   * this list and not its length. Nothing here touches the recordings: a word
   * on four cards is still recorded once.
   */
  items: PenItem[];
  /**
   * What the sentences held when the dialog opened, so the counting panel's
   * third quick choice can put them back — the undo for the other two. Built
   * here rather than in the panel because it is a fact about what was handed
   * in, and the panel's own copy of it would be a read of state it is about to
   * change.
   */
  held: ReadonlyMap<string, number>;
  /**
   * Which of the two panels is showing.
   *
   * Two steps rather than one long sheet, because the two questions are asked
   * of different things: the first is about a sheet of paper in the reader's
   * hand, the second about a game spread out on the floor. Putting ten rows of
   * plus and minus under a grid of eighty-eight circles would also push both
   * off the dialog.
   */
  step: 1 | 2;
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
export async function askPenExport(items: readonly PenItem[]): Promise<PenChoice | null> {
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
  /* Copied rather than held: the counts are edited in the dialog and a cancel
     has to leave the sentences as they were. What leaves is the map in
     `settle`, and the caller decides what to write. */
  const counted = items.map((one) => ({ ...one, copies: Math.max(1, Math.floor(one.copies)) }));
  const s = $state<Choosing>({
    sheet, startCode: true, start, step: 1,
    items: counted,
    held: new Map(counted.map((one) => [one.id, one.copies])),
    settle: () => {},
  });

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
