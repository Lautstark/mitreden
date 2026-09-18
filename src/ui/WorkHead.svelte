<script lang="ts">
  /**
   * The Sammlung you are in: its name, how much is in it, and what you can do
   * with the whole of it.
   *
   * bildhaft's row, with Herunterladen where Drucken is — the same question,
   * answered in audio instead of paper.
   */
  import TitleField from '@lautstark/design/svelte/TitleField';
  import { menuOn } from '@lautstark/design/menu';
  import { renameCollection } from '../db/repo.ts';
  import { ALL, here, load, nameCaret, searching, shown } from './store.svelte.ts';
  import { deleteCollection, packAll, packPen } from './sammlung.ts';
  import { exportCollection } from './settings.ts';
  import { t, tn } from './words.svelte.ts';

  let { showCollectionVoice }: { showCollectionVoice: (id: string) => void } = $props();

  let download: HTMLButtonElement;
  let more: HTMLButtonElement;

  /* Renaming is typing in the title (§1.6), and the field is
     @lautstark/design/svelte/TitleField — conventions.md §6.5, over
     `@lautstark/design/rename` unchanged. The debounce, the write on the way
     out, the refusal to write a value that has not moved and the guard against
     a repaint typing over somebody were already the package's; what the
     component takes with it is the three things this file had bolted onto that
     separately.

     `refresh()` before focusing, which §6.5 makes the rule and this product
     already did, and `select`, which is true here: „+ Neue Sammlung" makes the
     Sammlung at once and names it for the day, so the first keystroke has to
     replace that date (§1.5). Both are inside the component now, reached
     through `caret` — a rune in the store rather than an exported method two
     levels of props away. See `nameCaret` there for why that direction is the
     one §6.5 settled on.

     The `oninput` echo is the third and is the reason `rename.js` binds with
     `addEventListener` rather than taking the property: this listener sits
     beside the package's own on the same field, and the component forwards it
     rather than replacing it.

     What stays here is this product's own answer to an empty name, which is to
     refuse it — a Sammlung must always be callable by something in the
     sidebar. §1.6 records that as correct and per product: vorlaut writes the
     empty name and draws a fallback.

     Which Sammlung a pending rename is for is taken on the keystroke rather
     than read when the write runs. Pressing a sidebar row moves focus off the
     field first, so the blur writes before the switch and the two are the same
     in practice — but that is an ordering, not a guarantee. */
  let renaming: { id: string; name: string } | null = null;

  async function rename(typed: string): Promise<void> {
    if (!renaming || !typed.trim() || typed === renaming.name) return;
    await renameCollection(renaming.id, typed);
    await load();
  }

  /**
   * How much is here and how much of it is still open.
   *
   * A fraction made sense when a Sammlung was a filter over one long list. It
   * is a place now, and "0 of 3" in an empty one reads as an error.
   */
  let count = $derived.by(() => {
    const items = shown();
    const pending = items.filter((item) => item.state !== 'ok').length;
    return searching()
      ? t('count_filtered', { n: items.length, all: ALL().length })
      : !items.length ? t('count_none')
        : tn('count', items.length)
          + (pending ? t('count_open', { n: pending }) : t('count_all_recorded'));
  });

  /**
   * Which format, asked the way every other question on this page is asked. It
   * was a native select, and the case written for it was that the browser draws
   * the open list, so nothing was left to get wrong per theme. True — and
   * beside the point: what the browser draws belongs to no design language, and
   * this sat next to a ⋯ that opens the shared menu.
   */
  function openDownload(): void {
    menuOn(download, (add: (label: string, run: () => void) => void) => {
      add(t('download_mp3'), () => void packAll('mp3'));
      add(t('download_wav'), () => void packAll('wav'));
      add(t('download_pen'), () => void packPen());
    });
  }

  /* conventions.md §3.6, in its own order: what acts on this Sammlung, then
     what this Sammlung is set to, then the delete. The voice is here rather
     than in Einstellungen because its answer changes with which Sammlung is
     open, which is §3.10's test — and beside the name there is no question
     about which one the menu means.

     Three items, which is vorlaut's exactly. „Sammlung neu aufnehmen" was the
     first of four until 2026-08-29: an item permanently present whose most
     common outcome was the sentence „Alles hier ist schon … aufgenommen", and
     the settings sheet below it ended by telling you to come back up here and
     press it. It is a button in that sheet now, carrying its own count. */
  function openMore(): void {
    menuOn(more, (add: (label: string, run: () => void, opts?: { danger?: boolean }) => void) => {
      const current = here();
      if (!current) return;
      add(t('collection_export'), () => void exportCollection(current));
      add(t('collection_settings'), () => showCollectionVoice(current.id));
      add(t('collection_delete'), () => {
        void deleteCollection(current.id, current.name, current.count);
      }, { danger: true });
    });
  }
</script>

<div class="workhead">
  <TitleField
    id="colname"
    value={here()?.name ?? ''}
    write={rename}
    oninput={() => { renaming = here() ?? null; }}
    placeholder={t('collection_name_hint')}
    label={t('collection_name_hint')}
    caret={nameCaret}
  />
  <span class="count" id="count">{count}</span>
  <!-- bildhaft's Drucken is one button because printing asks nothing further.
       This one has to ask which format, so it keeps the button's shape and
       opens the same menu the ⋯ opens. -->
  <span class="menu-anchor"><button id="dlall" class="btn quiet sm dropdown" bind:this={download}
    aria-haspopup="menu" aria-expanded="false" onclick={openDownload}>{t('download_all')}</button></span>
  <span class="menu-anchor"><button id="colmore" class="btn quiet icon" bind:this={more}
    aria-haspopup="menu" aria-expanded="false" title={t('more_actions')}
    aria-label={t('more_actions')} onclick={openMore}>⋯</button></span>
</div>
