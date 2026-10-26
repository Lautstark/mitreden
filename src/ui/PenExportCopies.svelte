<script lang="ts">
  /**
   * The second panel of the Anybook export: how many stickers each sentence
   * gets.
   *
   * ## Why this is a list and nothing else
   *
   * A Klettspiel has thirty cards made of ten words, and the words are not
   * evenly spread — four foxes, three owls, one title. A single "times two"
   * would be wrong for every row of such a game, so the number is per
   * sentence.
   *
   * There was a bank of quick choices over it — alle 1×, alle 2×, wie
   * gespeichert — and it is gone. Three actions drawn as a segmented control,
   * which is the shape that says "one of these is the current one" about three
   * things that are none of them a state: it sat above the list looking
   * broken, with nothing selected, and it was the first thing anybody asked
   * about. What it offered was thin, too. The list opens on what the sentences
   * already hold, one each being what a sentence holds when nobody has said
   * otherwise (Phrase.copies), and a Spiel arrives with its counts off the
   * board — so "alle 1×" was a reset for a state hardly anybody is in, and the
   * undo for it was the third button.
   *
   * ## What the numbers underneath are for
   *
   * Thirty stickers of eighty-eight is a sheet; ninety is two, and the second
   * is nearly empty. That is a decision somebody makes before printing — leave
   * one word out, or buy the small paper — and it cannot be made from a count
   * of sentences. So the panel says what it will cost in circles and in sheets,
   * against the sheet and the start chosen on the first panel.
   *
   * The inline styles are this dialog's own, as in PenExportBody: there is no
   * baseline picture for it and these are measurements somebody made against a
   * real sheet of paper.
   */
  import { circlesUsed, sheetsUsed } from '../core/anybook.ts';
  import type { Choosing } from './penExport.svelte.ts';
  import { t, tn } from './words.svelte.ts';

  let { s }: { s: Choosing } = $props();

  let stickers = $derived(s.items.reduce((n, one) => n + one.copies, 0));
  let circles = $derived(circlesUsed(stickers, s.startCode, s.start));
  let sheets = $derived(sheetsUsed(s.sheet, circles));
  /** Circles left on the paper this run covers. The number that says whether
   *  one word more would cost a whole second sheet. */
  let free = $derived(sheets * s.sheet.cols * s.sheet.rows - circles);

  /* Clamped on the way in rather than refused: a field somebody is in the
     middle of typing is briefly empty, and an empty field that snaps to 1
     cannot be typed into. Floored because half a sticker cannot be printed. */
  const set = (one: { copies: number }, value: string): void => {
    one.copies = Math.max(1, Math.min(999, Math.floor(Number(value) || 1)));
  };
</script>

<!-- What the numbers are, in one line. The list is a column of steppers with
     nothing else saying what they count, and „1" beside a sentence could as
     easily be a position as a quantity. -->
<p class="hint" style="margin:0 0 8px">{t('pen_copies_lead')}</p>

<!-- Scrolls, because a Sammlung is as long as it is and the numbers below it
     are what the panel is for: pushing them off the sheet would leave somebody
     counting stickers in their head.

     Whole rows: the rows are a fixed height and the box is eight of them, so
     the list is cut between two rows rather than through one. A half-row at
     the edge reads as something that failed to draw. -->
<div style="border:1px solid var(--line);border-radius:var(--radius-sm);max-height:320px;overflow-y:auto">
  {#each s.items as item (item.id)}
    <div style="display:flex;align-items:center;gap:10px;height:40px;box-sizing:border-box;padding:0 10px;border-bottom:1px solid var(--line)">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{item.text}</span>
      <!-- The three kept together as one control, because they are one: a
           number with a way up and a way down, not three things on a row. -->
      <span style="display:flex;align-items:center;gap:4px;flex:none">
        <button type="button" style="padding:2px 10px;min-width:0"
          aria-label={t('pen_copies_less', { text: item.text })}
          onclick={() => { item.copies = Math.max(1, item.copies - 1); }}>−</button>
        <input type="number" min="1" max="999" style="width:3.5rem;text-align:center"
          aria-label={t('pen_copies_for', { text: item.text })}
          value={item.copies} oninput={(event) => set(item, event.currentTarget.value)}>
        <button type="button" style="padding:2px 10px;min-width:0"
          aria-label={t('pen_copies_more', { text: item.text })}
          onclick={() => { item.copies = Math.min(999, item.copies + 1); }}>+</button>
      </span>
    </div>
  {/each}
</div>

<!-- Circles rather than "x of 88": past one sheet there is no single number of
     circles to be out of, and the room left is the line below. -->
<p style="margin:16px 0 0">{t('pen_copies_total', {
  stickers: tn('pen_stickers', stickers),
  circles,
  sheets: tn('pen_ask_sheets', sheets),
})}</p>
<p class="hint" style="margin:4px 0 0">{t('pen_copies_room', {
  n: tn('count', s.items.length),
  free,
})}</p>
