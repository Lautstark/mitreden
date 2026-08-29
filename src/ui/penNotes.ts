/**
 * The two lines printed along the top of a label sheet.
 *
 * Its own module, and pure, because the last thing that went wrong here went
 * wrong on paper. The sheet said "der erste Aufkleber ist der Startcode" on a
 * run exported without one — a sentence that was true when it was written and
 * became a lie when the start code turned into a choice. Nothing caught it:
 * the text was assembled inline in a click handler, where no test could reach
 * it, and the only place it appears is a PDF nobody reads until it is printed.
 *
 * So it is a function that takes facts and returns strings, and the checks it
 * needs live beside it.
 */

import { t, tn } from '../i18n/index.ts';

export interface SheetNotes {
  title: string;
  /** Already formatted; this does not know what a date looks like here. */
  date: string;
  sentences: number;
  product: string;
  /** Circles on one sheet of this kind. */
  per: number;
  url: string;
  startCode: boolean;
  /** The first circle of the run, 1-based. */
  start: number;
  /** Which sheet of how many, both 1-based. */
  page: number;
  pages: number;
}

export function sheetNotes(o: SheetNotes): string[] {
  return [
    [
      o.pages === 1
        ? t('pen_sheet_what', { title: o.title, date: o.date, n: tn('count', o.sentences) })
        : o.page === 1
          ? t('pen_sheet_first', { title: o.title, date: o.date, of: o.pages })
          : t('pen_sheet_more', { title: o.title, date: o.date, n: o.page, of: o.pages }),
      // Both are true of the first sheet only, and only when they are true at
      // all: the start code is a choice, and the sheets after the first begin
      // at the top of their own.
      o.startCode && o.page === 1 ? t('pen_sheet_code') : '',
      o.start > 1 && o.page === 1 ? t('pen_sheet_from', { n: o.start }) : '',
    ].filter(Boolean).join(' · '),
    t('pen_sheet_paper', {
      product: o.product,
      n: o.per,
      // The address without its scheme: it is read off paper, not clicked.
      url: o.url.replace(/^https?:\/\/(www\.)?/, ''),
    }),
  ];
}
