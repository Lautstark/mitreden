<script lang="ts">
  /**
   * The three pages the footer opens: what this is, and the two German legal
   * ones. bildhaft's shape — dialogs in the app, not pages beside it.
   *
   * ## The whole dialog is @lautstark/design/svelte/Legal
   *
   * conventions.md §6.12, over §6.1's `Sheet`. One dialog with every page in
   * it, which is the shape this file already had: `page` was a `Page | null`
   * and the title and the body swapped. What the component adds is two things
   * this copy did not have —
   *
   * - **every section is drawn and the ones not showing are `hidden`**, which
   *   is vorlaut's shape and has to be, because its markup is addressed and
   *   mounting one page at a time would make whether a locator resolves depend
   *   on which page happened to be open. It costs this product nothing: the
   *   bodies are one built HTML string each (ui/info.ts argues that, and the
   *   frame being shared did not change it);
   * - **from the top, every time.** A sheet keeps its scroll position, and the
   *   privacy notice is long enough that reopening it half way down reads as a
   *   page starting in the middle of a sentence. vorlaut's finding, and the
   *   one behaviour in the component that is not markup.
   *
   * The accessible name is the current page's title, through §6.1's thunk — so
   * a reader that announces the dialog says „Impressum" while the Impressum is
   * showing.
   *
   * ## Two of the three ids are back, and the third is still nobody's
   *
   * `#infotitle`, `#infobody` and `#infoclose` were this dialog's heading, its
   * body region and its ✕, and three e2e assertions named each. Adopting
   * `Legal` lost all three: `Sheet` had taken `closeId` and `bodyId` since
   * design v1.35.0, but the wrapper forwarded neither — which §6.12 turned into
   * the general rule, that a wrapper hiding a prop its own consumers need has
   * not simplified anything, it has moved the reach one level up.
   *
   * `Legal` forwards both as of design v1.37.0 and this product is on v1.38.1,
   * so `closeId` and `bodyId` are passed below and e2e/app.spec.ts names
   * `#infoclose` and `#infobody` again. Nothing is written onto the frame
   * afterwards, which was the rule the structural locators were holding.
   *
   * `#infotitle` is the one that does not come back, and it is not waiting on
   * an oversight: `Sheet` draws the `<h2>` from the `title` thunk and takes no
   * `titleId`, so there is no seam for it in either component. `#info .head h2`
   * is what names the heading, here and in e2e/visual.spec.ts, and it will go
   * on doing so until the frame grows the prop — which nothing is asking it to,
   * one product having one assertion.
   *
   * What the component gives that this file never had is a per-page `<section>`
   * id, and the three below are the better half of the trade: each page is
   * nameable whether or not it is the one showing.
   */
  import Legal from '@lautstark/design/svelte/Legal';
  import { htmlOf, PAGES, titleOf, type Page } from './info.ts';
  import { t } from './words.svelte.ts';

  let { page = $bindable() }: { page: Page | null } = $props();

  /* `$derived`, because the about page's title follows the language and this
     page changes language without reloading. The ids are this product's names
     for the three sections; nothing in any stylesheet selects them. */
  const pages = $derived(PAGES.map((key) => ({
    key, title: titleOf(key), id: `info-${key}`,
  })));
</script>

<!-- `bind:page`, which is the form Legal asks for and which this dialog can
     give it: `page` really is the key, and every way out — the ✕, Escape, a
     press outside — has to end with this and the dialog agreeing rather than
     one of them left behind.

     `closeLabel` is read here rather than captured, for the language's reason
     again: `t` is a dependency of whatever drew with it. -->
<Legal id="info" bind:page {pages} closeLabel={t('close')}
  closeId="infoclose" bodyId="infobody">
  <!-- Straight into the section, with no box in between. The prose is three
       HTML strings (ui/info.ts) and `.sheet > .body > p` no longer reaches
       through the `<section>` Legal draws — src/styles/app.css says the same
       two rules one level down, with components.css's own values, so this is
       the same page it was. -->
  {#snippet children(key)}{@html htmlOf(key as Page)}{/snippet}
</Legal>
