<script lang="ts">
  /**
   * Three dialogs, not pages: bildhaft's shape. The one-line privacy summary is
   * gone from here on purpose — a footer has no room to say what does leave,
   * and a claim without its exception reads as broader than it is. The about
   * dialog has the room.
   */
  import { about, datenschutz, impressum, type Page } from './info.ts';
  import { t } from './words.svelte.ts';

  let { show }: { show: (page: Page) => void } = $props();
</script>

<footer class="footer">
  <button class="linklike" id="about" onclick={() => show(about())}>{t('about_link')}</button>
  <button class="linklike" id="impressum" onclick={() => show(impressum())}>Impressum</button>
  <button class="linklike" id="datenschutz" onclick={() => show(datenschutz())}>Datenschutz</button>
</footer>
