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
 */

import { DEFAULT_SHEET, SHEETS, sheetsFor, type Sheet } from '../core/anybook.ts';
import { openDialog } from './dialog.ts';
import { loadSettings } from '../db/db.ts';
import { t, tn } from '../i18n/index.ts';

export interface PenChoice {
  sheet: Sheet;
  /** Whether a circle is spent on the activation code. */
  startCode: boolean;
  /** The first circle this run may use, 1-based. */
  start: number;
}

const node = (tag: string, css: string, text?: string): HTMLElement => {
  const element = document.createElement(tag);
  element.style.cssText = css;
  if (text !== undefined) element.textContent = text;
  return element;
};

/**
 * Asks, and resolves null if the reader closes it any other way.
 *
 * `sentences` is only ever read to say how much room is needed; nothing here
 * touches the recordings.
 */
export async function askPenExport(sentences: number): Promise<PenChoice | null> {
  const remembered = (await loadSettings()).pen;
  let sheet = SHEETS[remembered?.sheet ?? DEFAULT_SHEET] ?? SHEETS[DEFAULT_SHEET];
  let startCode = true;
  let start = 1;

  /* The suggestion, and its limits. It is where the last run ended, which is
     only where this one begins if that sheet was kept and printed — so it is
     offered and never assumed, and a sheet with no room left for it falls back
     to the top rather than opening on an impossible answer. */
  if (remembered?.sheet === sheet.id && remembered.next > 1
    && remembered.next <= sheet.cols * sheet.rows) start = remembered.next;

  return new Promise<PenChoice | null>((done) => {
    let answer: PenChoice | null = null;

    // Named on screen, not only to a screen reader: the control below it is a
    // row of product codes, and the row beside the number field has a visible
    // label. One of the two having none was the inconsistency.
    const sheetName = node('p', 'margin:0 0 6px', t('pen_ask_sheet'));
    const sheetRow = node('div', 'margin:0 0 16px');
    sheetRow.className = 'segmented';
    sheetRow.setAttribute('role', 'group');
    sheetRow.setAttribute('aria-label', t('pen_ask_sheet'));

    const codeBox = node('label', 'display:flex;gap:10px;align-items:flex-start;margin:0 0 16px');
    const codeInput = document.createElement('input');
    codeInput.type = 'checkbox';
    codeInput.checked = startCode;

    const startLabel = node('label', '', t('pen_ask_start'));
    startLabel.setAttribute('for', 'penstart');
    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.id = 'penstart';
    startInput.min = '1';
    startInput.style.width = '5rem';

    const map = node('div', 'display:grid;gap:4px;background:var(--surface-2);padding:12px;'
      + 'border-radius:var(--radius-sm);margin:8px 0 0');
    const summary = node('p', 'margin:16px 0 0');
    summary.className = 'hint';
    const paper = node('p', '');
    paper.className = 'hint';

    function draw(): void {
      const total = sheet.cols * sheet.rows;
      startInput.max = String(total);
      startInput.value = String(start);

      for (const button of sheetRow.querySelectorAll('button'))
        button.setAttribute('aria-pressed', String(button.dataset.sheet === sheet.id));

      /* The map. Circles before the start are the ones already peeled and are
         drawn empty; the run ahead is filled. The first of the run is the
         activation code when there is one, and wears Studio's own colour for it
         so the sheet on screen and the sheet in Studio agree. */
      map.style.gridTemplateColumns = `repeat(${sheet.cols}, 1fr)`;
      /* Capped by height rather than width. The circles are square, so 315 of
         them in fifteen columns would stand about 700 px tall and push the
         buttons off the dialog; holding the height and letting the width follow
         keeps both sheets the same size on screen and both still clickable. */
      map.style.maxWidth = `${Math.round(360 * sheet.cols / sheet.rows)}px`;
      map.innerHTML = '';
      const room = total - start + 1;
      const need = sentences + (startCode ? 1 : 0);
      for (let i = 1; i <= total; i++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        const used = i < start;
        const isCode = startCode && i === start;
        const inRun = !used && i < start + Math.min(need, room);
        /* Three states, in the page's own tokens rather than borrowed ones: a
           circle already peeled, one this run will use, and the start code.
           The start code is --warn, which is the amber Studio draws it in — the
           sheet on screen and the sheet in Studio then agree about which one it
           is. The run is --accent rather than a literal blue, so it follows the
           theme instead of fighting it. */
        const edge = isCode ? 'var(--warn)' : used ? 'var(--line)' : 'var(--accent)';
        dot.style.cssText = 'aspect-ratio:1;border-radius:50%;padding:0;min-width:0;cursor:pointer;'
          + `border:1px solid ${edge};`
          + `background:${isCode ? 'var(--warn)' : inRun ? 'var(--accent)' : 'transparent'};`;
        dot.setAttribute('aria-label', t('pen_ask_position', { n: i }));
        dot.onclick = () => { start = i; draw(); };
        map.appendChild(dot);
      }

      const needed = sheetsFor(sheet, sentences + (start - 1) - (startCode ? 0 : 1));
      summary.textContent = t('pen_ask_summary', {
        // The Sammlung's own plural, which the list already says out loud.
        n: tn('count', sentences),
        code: startCode ? t('pen_ask_with_code') : t('pen_ask_without_code'),
        start,
        sheets: tn('pen_ask_sheets', needed),
      });
      /* Named and linked, because the answer to "which paper is this" is a
         thing to buy and the reader is about to need it. */
      paper.innerHTML = '';
      const link = document.createElement('a');
      link.href = sheet.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = sheet.product;
      paper.append(link, document.createTextNode(` · ${t('pen_ask_paper', { per: total })}`));
    }

    for (const one of Object.values(SHEETS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.sheet = one.id;
      button.textContent = one.label;
      button.onclick = () => {
        sheet = one;
        start = Math.min(start, one.cols * one.rows);
        draw();
      };
      sheetRow.appendChild(button);
    }

    codeInput.onchange = () => { startCode = codeInput.checked; draw(); };
    const codeText = node('span', '', t('pen_ask_code'));
    const why = node('span', 'display:block', t('pen_ask_code_why'));
    why.className = 'hint';
    codeText.appendChild(why);
    codeBox.append(codeInput, codeText);

    startInput.oninput = () => {
      const total = sheet.cols * sheet.rows;
      start = Math.max(1, Math.min(total, Number(startInput.value) || 1));
      draw();
    };

    const startRow = node('div',
      'display:flex;align-items:center;justify-content:space-between;gap:12px');
    startRow.append(startLabel, startInput);

    /* The classes confirmDialog gives its own two, so this dialog's foot looks
       like every other dialog's foot rather than like the browser's. */
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = t('cancel');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary';
    confirm.textContent = t('pen_ask_do');

    const open = openDialog({
      title: t('pen_ask_title'),
      body: [sheetName, sheetRow, codeBox, startRow, map, summary, paper],
      footer: [cancel, confirm],
      onClose: () => done(answer),
    });
    cancel.onclick = () => open.close();
    confirm.onclick = () => { answer = { sheet, startCode, start }; open.close(); };

    draw();
  });
}
