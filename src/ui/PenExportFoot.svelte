<script lang="ts">
  /**
   * The two ways out. The classes are the ones confirmDialog gives its own
   * pair, so this dialog's foot looks like every other dialog's foot rather
   * than like the browser's.
   *
   * The confirm writes the answer down and then closes; `onClose` in
   * penExport.svelte.ts is what resolves the promise, for both of these and for
   * the ✕, Escape and a press outside besides. One exit for every way out.
   */
  import type { Choosing } from './penExport.svelte.ts';
  import type { Handle } from './sheet.svelte.ts';
  import { t } from './words.svelte.ts';

  let { s, handle }: { s: Choosing; handle: Handle } = $props();
</script>

<button class="btn" type="button" onclick={() => handle.close()}>{t('cancel')}</button>
<button class="btn primary" type="button" onclick={() => {
  s.answer = { sheet: s.sheet, startCode: s.startCode, start: s.start };
  handle.close();
}}>{t('pen_ask_do')}</button>
