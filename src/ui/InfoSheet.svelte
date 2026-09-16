<script lang="ts">
  /**
   * The three pages the footer opens: what this is, and the two German legal
   * ones. bildhaft's shape — dialogs in the app, not pages beside it.
   *
   * One dialog for all three, because they are one shape with different words;
   * `page` is which of them is showing, and null is closed.
   *
   * ## Why this is markup and not openDialog()
   *
   * The dynamic sheets in this product — the pen export, every confirmation —
   * are @lautstark/design/dialog's frame, and stay that way. This one is not a
   * frame this product builds: it has been in the page since before there was a
   * package, its ✕ is `.btn.quiet.icon` where the package's is `.btn.icon`, and
   * its body carries no `.body` class, so the shared `.sheet .body` padding
   * does not reach the prose. Those are in the baseline picture
   * (e2e/visual.spec.ts, info.png), which is compared at a tolerance of zero.
   * So the markup moved here as it stood, and what changed is only who owns it.
   */
  import type { Page } from './info.ts';
  import { t } from './words.svelte.ts';

  let { page = $bindable() }: { page: Page | null } = $props();

  let sheet: HTMLDialogElement;

  /* Shown and hidden from the one fact, so every way out — the ✕, Escape — ends
     with `page` and the dialog agreeing rather than one of them left behind. */
  $effect(() => {
    if (page && !sheet.open) sheet.showModal();
    if (!page && sheet.open) sheet.close();
  });
</script>

<dialog id="info" class="sheet" bind:this={sheet} onclose={() => { page = null; }}>
  <div class="head">
    <h2 id="infotitle">{page?.title ?? ''}</h2>
    <button id="infoclose" class="btn quiet icon" aria-label={t('close')} onclick={() => { page = null; }}>✕</button>
  </div>
  <div id="infobody">{@html page?.html ?? ''}</div>
</dialog>
