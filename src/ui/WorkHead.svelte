<script lang="ts">
  /**
   * The Sammlung you are in: its name, how much is in it, and what you can do
   * with the whole of it.
   *
   * bildhaft's row, with Herunterladen where Drucken is — the same question,
   * answered in audio instead of paper.
   */
  import { renameField, type RenameField } from '@lautstark/design/rename';
  import { menuOn } from '@lautstark/design/menu';
  import { renameCollection } from '../db/repo.ts';
  import { ALL, here, load, searching, shown } from './store.svelte.ts';
  import { deleteCollection, packAll, packPen } from './sammlung.ts';
  import { exportCollection } from './settings.ts';
  import { t, tn } from './words.svelte.ts';

  let { showCollectionVoice }: { showCollectionVoice: (id: string) => void } = $props();

  let title: HTMLInputElement;
  let name: RenameField | null = null;
  let download: HTMLButtonElement;
  let more: HTMLButtonElement;

  /**
   * Straight into the name, selected: typing replaces the date a new Sammlung
   * was given. Through refresh() like every other assignment — the field is not
   * focused yet, because pressing "+ Neue Sammlung" is what took focus off it,
   * so the package's guard passes and its idea of what it last wrote stays
   * true.
   */
  export function focusName(): void {
    name?.refresh(here()?.name ?? '');
    title.focus();
    title.select();
  }

  /* Renaming is typing in the title (§1.6). The debounce, the write on the way
     out and the guard against a repaint typing over you are the package's; what
     is left here is this product's own answer to an empty name, which is to
     refuse it — a Sammlung must always be callable by something in the rail.

     Which Sammlung a pending rename is for is taken on the keystroke rather
     than read when the write runs. Pressing a rail row moves focus off the
     field first, so the blur writes before the switch and the two are the same
     in practice — but that is an ordering, not a guarantee. */
  let renaming: { id: string; name: string } | null = null;

  $effect(() => {
    name = renameField(title, async (typed: string) => {
      if (!renaming || !typed.trim() || typed === renaming.name) return;
      await renameCollection(renaming.id, typed);
      await load();
    });
    return () => { name?.stop(); name = null; };
  });

  /* The header names where you are. Through refresh() rather than by assigning:
     the package declines while the field is being typed in — the caret jumping
     mid-word is the reason that guard exists — and also while a keystroke is
     still waiting out its debounce. */
  $effect(() => {
    const current = here();
    name?.refresh(current?.name ?? '');
  });

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
  <input id="colname" class="title-input" bind:this={title}
    placeholder={t('collection_name_hint')} aria-label={t('collection_name_hint')}
    autocomplete="off" oninput={() => { renaming = here() ?? null; }}>
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
