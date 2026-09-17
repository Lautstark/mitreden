<script lang="ts">
  /**
   * The two ways out. The classes are the ones confirmDialog gives its own
   * pair, so this dialog's foot looks like every other dialog's foot rather
   * than like the browser's.
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

<button class="btn" type="button" onclick={() => {
  s.settle(null);
  handle.close();
}}>{t('cancel')}</button>
<button class="btn primary" type="button" onclick={() => {
  s.settle({ sheet: s.sheet, startCode: s.startCode, start: s.start });
  handle.close();
}}>{t('pen_ask_do')}</button>
