<script lang="ts">
  /**
   * Three dialogs, not pages: bildhaft's shape. The one-line privacy summary is
   * gone from here on purpose — a footer has no room to say what does leave,
   * and a claim without its exception reads as broader than it is. The about
   * dialog has the room.
   *
   * ## The shell is @lautstark/design/svelte/Footer, and the words are not
   *
   * conventions.md §6.12. What the component is, is the landmark and the one
   * line above the links; the links themselves arrive as children, in this
   * product's order and this product's words, because what a footer may
   * *claim* is governed by §4.3's „prose that denies must also disclose" and
   * that is not a rule a shared component can keep on a product's behalf.
   *
   * `credit` is not passed and this is the only footer of the three with
   * nothing to put in it. bildhaft's is a licence condition that follows the
   * source in force; vorlaut has an outward link through its own guard; this
   * one has no attribution obligation and no outward link at all. The
   * component draws no paragraph where there is no credit, which is what keeps
   * an empty row of air out of a footer measured in single pixels — the same
   * argument §6.2 makes about the panel's empty state span.
   *
   * The links are not wrapped, and that is the component's decision rather
   * than an omission here: `text-align: center` and the word space between
   * three buttons is what spaces them, and a wrapper would have moved them.
   */
  import Footer from '@lautstark/design/svelte/Footer';
  import type { Page } from './info.ts';
  import { t } from './words.svelte.ts';

  let { show }: { show: (page: Page) => void } = $props();
</script>

<Footer>
  <button class="linklike" id="about" onclick={() => show('about')}>{t('about_link')}</button>
  <button class="linklike" id="impressum" onclick={() => show('impressum')}>Impressum</button>
  <button class="linklike" id="datenschutz" onclick={() => show('datenschutz')}>Datenschutz</button>
</Footer>
