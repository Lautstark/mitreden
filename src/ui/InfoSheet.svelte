<script lang="ts">
  /**
   * The three pages the footer opens: what this is, and the two German legal
   * ones. bildhaft's shape — dialogs in the app, not pages beside it.
   *
   * One dialog for all three, because they are one shape with different words;
   * `page` is which of them is showing, and null is closed.
   *
   * ## The frame is @lautstark/design/svelte/Sheet
   *
   * It was hand-written markup until 2026-09-17, and what kept it that way was
   * two pixel differences rather than a disagreement: the ✕ was
   * `.btn.quiet.icon` where the package's is `.btn.icon`, and the prose sat in
   * a bare `<div id="infobody">` rather than in a `.body`, so the shared
   * region rule never reached it. conventions.md §6.1 settles both against
   * this copy — converging the other way would move every sheet in the family
   * that already goes through `openDialog`, and those are not the copies being
   * replaced — so info.png was re-recorded with the change that moved it.
   *
   * `open` is one-way here, which §6.1 says is not the lesser form: `page` is
   * a `Page | null` and `bind:` cannot take a `$derived`, so the sheet is told
   * whether to be open and `onclose` is what puts the null back.
   *
   * The `head` snippet is not decoration either — it is what carries
   * `#infotitle`, which two e2e files read. §6.1: head *replaces* the `<h2>`,
   * so this is the heading rather than a second one beside a hidden one.
   */
  import Sheet from '@lautstark/design/svelte/Sheet';
  import type { Page } from './info.ts';
  import { nameParts } from './dialog.ts';
  import { t } from './words.svelte.ts';

  let { page = $bindable() }: { page: Page | null } = $props();

  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  $effect(() => nameParts(dialog, { close: 'infoclose', body: 'infobody' }));
</script>

<!-- `closeLabel` is read here rather than captured: `t` is a dependency of
     whatever drew with it (ui/words.svelte.ts), and this page changes language
     without reloading — a label taken once would be the language the reader
     has just left. -->
<Sheet
  id="info"
  open={page !== null}
  title={page?.title ?? ''}
  closeLabel={t('close')}
  onclose={() => { page = null; }}
  bind:dialog
>
  {#snippet head()}<h2 id="infotitle">{page?.title ?? ''}</h2>{/snippet}
  <!-- Straight into the `.body`, with no box in between: `.sheet > .body > p`
       and `> p + p` are the rules that space this prose, and they are direct
       children. -->
  {@html page?.html ?? ''}
</Sheet>
