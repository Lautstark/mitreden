<script lang="ts">
  /**
   * The body of the Anybook export question: which sheet, whether a circle is
   * spent on the start code, and where on the paper this run begins.
   *
   * The left of two columns. The right is PenExportCopies, and they are one
   * question: how many stickers decides how much paper, and where the run
   * starts decides whether they fit. They were two panels with „Weiter"
   * between them until 2026-10-27 — see askPenExport for why that was wrong
   * twice over.
   *
   * The inline styles are what they were. This dialog has no baseline picture
   * and none of these is a token, but every one of them is a measurement
   * somebody made against a real sheet of paper, so they moved across as they
   * stood rather than being reasoned about again.
   */
  import { SHEETS } from '../core/anybook.ts';
  import PenExportCopies from './PenExportCopies.svelte';
  import type { Choosing } from './penExport.svelte.ts';
  import { t } from './words.svelte.ts';

  let { s }: { s: Choosing; handle: unknown } = $props();

  let total = $derived(s.sheet.cols * s.sheet.rows);
  let room = $derived(total - s.start + 1);
  /* Stickers, not sentences: a word on four cards fills four circles, and the
     grid below has to draw what will really be printed. */
  let stickers = $derived(s.items.reduce((n, one) => n + one.copies, 0));
  let need = $derived(stickers + (s.startCode ? 1 : 0));


  /* Three states, in the page's own tokens rather than borrowed ones: a circle
     already peeled, one this run will use, and the start code. The start code
     is --warn, which is the amber Studio draws it in — the sheet on screen and
     the sheet in Studio then agree about which one it is. The run is --accent
     rather than a literal blue, so it follows the theme instead of fighting
     it. */
  function dot(i: number): string {
    const used = i < s.start;
    const isCode = s.startCode && i === s.start;
    const inRun = !used && i < s.start + Math.min(need, room);
    const edge = isCode ? 'var(--warn)' : used ? 'var(--line)' : 'var(--accent)';
    return 'aspect-ratio:1;border-radius:50%;padding:0;min-width:0;cursor:pointer;'
      + `border:1px solid ${edge};`
      + `background:${isCode ? 'var(--warn)' : inRun ? 'var(--accent)' : 'transparent'};`;
  }
</script>

<!-- Two columns, and one on a phone: the paper on the left, the sentences on
     the right. app.css has the breakpoint — `.penexport .cols`. -->
<div class="cols">
  <div>
<!-- Named on screen, not only to a screen reader: the control below it is a row
     of product codes, and the row beside the number field has a visible label.
     One of the two having none was the inconsistency. -->
<p style="margin:0 0 6px">{t('pen_ask_sheet')}</p>
<div class="segmented" style="margin:0 0 16px" role="group" aria-label={t('pen_ask_sheet')}>{#each Object.values(SHEETS) as one}<button
  type="button" aria-pressed={one.id === s.sheet.id} onclick={() => {
    s.sheet = one;
    s.start = Math.min(s.start, one.cols * one.rows);
  }}>{one.label}</button>{/each}</div>

<label style="display:flex;gap:10px;align-items:flex-start;margin:0 0 16px">
  <input type="checkbox" bind:checked={s.startCode}>
  <span>{t('pen_ask_code')}<span class="hint" style="display:block">{t('pen_ask_code_why')}</span></span>
</label>

<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
  <label for="penstart">{t('pen_ask_start')}</label>
  <input id="penstart" type="number" min="1" max={total} style="width:5rem" value={s.start}
    oninput={(event) => {
      s.start = Math.max(1, Math.min(total, Number(event.currentTarget.value) || 1));
    }}>
</div>

<!-- The map. Circles before the start are the ones already peeled and are drawn
     empty; the run ahead is filled. The first of the run is the activation code
     when there is one.

     Capped by height rather than width. The circles are square, so 315 of them
     in fifteen columns would stand about 700 px tall and push the buttons off
     the dialog; holding the height and letting the width follow keeps both
     sheets the same size on screen and both still clickable. -->
<div style="display:grid;gap:4px;background:var(--surface-2);padding:12px;border-radius:var(--radius-sm);margin:8px 0 0;grid-template-columns:repeat({s.sheet.cols}, 1fr);max-width:{Math.round(360 * s.sheet.cols / s.sheet.rows)}px">{#each { length: total } as _, index}{@const i = index + 1}<button
  type="button" style={dot(i)} aria-label={t('pen_ask_position', { n: i })}
  onclick={() => { s.start = i; }}></button>{/each}</div>

<!-- Named and linked, because the answer to "which paper is this" is a thing to
     buy and the reader is about to need it. What the run costs is in the foot,
     where it is beside the button it is about and stays on screen. -->
<p class="hint" style="margin:10px 0 0"><a href={s.sheet.url} target="_blank" rel="noreferrer noopener">{s.sheet.product}</a> · {t('pen_ask_paper', { per: total })}</p>
  </div>

  <div>
    <PenExportCopies {s} />
  </div>
</div>
