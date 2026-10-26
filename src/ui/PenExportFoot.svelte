<script lang="ts">
  /**
   * The two ways out. The classes are the ones confirmDialog gives its own
   * pair, so this dialog's foot looks like every other dialog's foot rather
   * than like the browser's.
   *
   * ## Four buttons for two panels, and only one of them settles
   *
   * The question is asked in two halves (askPenExport), so the right-hand
   * button carries on to the second half before it exports, and the left-hand
   * one goes back there rather than cancelling. Moving between the panels is
   * not an answer: it writes `step` and nothing else, so nothing is settled
   * and the ✕ still means no.
   *
   * Cancel stays reachable on the first panel, which is the one the dialog
   * opens on. On the second, Escape and the ✕ are the way out — a button
   * labelled "Abbrechen" beside one labelled "Zurück" is two words for
   * leaving, and the one that throws away what was typed should not be the
   * easier of the two to hit.
   *
   * Each press says what it decided and then closes, which is conventions.md
   * §3.4's rule and the order it asks for. It used to write its answer onto
   * `s` and close, leaving `onClose` to resolve the promise from what it found
   * — tidier, and the shape §3.4 names as the one that "hangs forever on any
   * host that closes the dialog without firing it". The guard lives in
   * penExport.svelte.ts, so a close that follows a press changes nothing and a
   * close with no press at all still answers.
   */
  import type { Handle } from '@lautstark/design/svelte/sheet';
  import type { Choosing } from './penExport.svelte.ts';
  import { t } from './words.svelte.ts';

  let { s, handle }: { s: Choosing; handle: Handle } = $props();
</script>

{#if s.step === 1}
  <button class="btn" type="button" onclick={() => {
    s.settle(null);
    handle.close();
  }}>{t('cancel')}</button>
  <button class="btn primary" type="button" onclick={() => { s.step = 2; }}
  >{t('pen_ask_next')}</button>
{:else}
  <button class="btn" type="button" onclick={() => { s.step = 1; }}>{t('pen_ask_back')}</button>
  <button class="btn primary" type="button" onclick={() => {
    s.settle({
      sheet: s.sheet,
      startCode: s.startCode,
      start: s.start,
      // Every sentence, the ones at one included: the caller writes these back,
      // and a sentence turned back down has to lose the number it had.
      copies: new Map(s.items.map((one) => [one.id, one.copies])),
    });
    handle.close();
  }}>{t('pen_ask_do')}</button>
{/if}
