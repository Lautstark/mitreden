<script lang="ts">
  /**
   * The sidebar: which Sammlungen exist, which one you are in, and making one.
   *
   * A Sammlung is a place you work in, not a label a sentence happens to carry.
   * Clicking one opens it; Cmd or Ctrl adds a second, because working across
   * two of them at once is a real thing to be doing, and that has to be
   * reachable. §4.2, which is about the open set and not about how many
   * Sammlungen a sentence is in.
   *
   * Whether the rail is on screen is App.svelte's: it is two separate
   * questions — a drawer dismissed on a phone, a column put away on a laptop —
   * and the scrim and the ☰ that answer them are outside this element.
   */
  import { drawCollections } from '@lautstark/design/collections';
  import { createCollection } from '../db/repo.ts';
  import { ALL, DECLARED, OPEN, ask, asked, load, openAlso, openOnly } from './store.svelte.ts';
  import { lang, t } from './words.svelte.ts';
  import { say } from './dom.ts';

  let { drawer, dismiss, collapse, showSettings, nameNew }: {
    /** On a phone: the rail is a layer over the work and this is whether it is up. */
    drawer: boolean;
    /** Put the layer away. Does nothing where the rail is a column of the page. */
    dismiss: () => void;
    /** Put the column away for good — a laptop question, remembered. */
    collapse: () => void;
    showSettings: () => void;
    /** Into the new Sammlung's name, selected. The field is in the head over
     *  the list, so the caret is sent there rather than moved from here. */
    nameNew: () => void;
  } = $props();

  let rows: HTMLElement;

  const counts = (): Map<string, number> => {
    const out = new Map<string, number>();
    for (const item of ALL())
      if (item.collection) out.set(item.collection, (out.get(item.collection) ?? 0) + 1);
    return out;
  };

  /* The rows are @lautstark/design/collections'. What is left here is what a
     row means in this program: a Sammlung's count is how many sentences are in
     it, and a press either opens it alone or adds it to what is open. Which key
     that flag stands for is the package's, so it cannot become Shift here and
     Cmd elsewhere. mitreden is still the one product that uses the additive
     flag — §4.2 — and that did not change when arity did.

     The module fills a container rather than handing back a node, so it is
     called in an effect over that container rather than hosted in a Vanilla.
     Reading DECLARED(), OPEN() and ALL() inside the effect is the whole of the
     subscription: the list is redrawn when a Sammlung is made, renamed,
     emptied or opened, and by nothing else. */
  $effect(() => {
    const count = counts();
    drawCollections(rows, {
      rows: DECLARED().map((collection) => ({
        id: collection.id,
        name: collection.name,
        count: count.get(collection.id) ?? 0,
      })),
      open: OPEN(),
      onPick: (key: string, additive: boolean) => {
        if (additive) openAlso(key);
        else openOnly(key);
        dismiss();
      },
    });
  });

  async function make(): Promise<void> {
    const made = await createCollection(null, lang() === 'de');
    openOnly(made.id);
    dismiss();
    say(t('done_collection_new', { name: made.name }));
    await load();
    // Straight into the name, selected: typing replaces the date it was given.
    nameNew();
  }
</script>

<aside id="rail" class="rail" class:open={drawer}>
  <div class="rail__brand">
    <h1><img class="logo" src="icon.svg" alt="" width="34" height="34">mitreden</h1>
    <!-- Two controls, because they answer two different questions: on a phone
         the rail is a layer over the work and ✕ dismisses it; on a desktop it
         is a column of the page and this puts the column away for good. -->
    <button id="railhide" class="btn quiet icon" aria-label={t('collections_hide')}
      title={t('collections_hide')} onclick={collapse}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
    <button id="railclose" class="btn quiet icon" aria-label={t('collections_hide')} onclick={dismiss}>✕</button>
  </div>

  <div class="rail__part">
    <input id="q" class="field" type="search" placeholder={t('search_hint')} autocomplete="off"
      value={asked()} oninput={(event) => ask(event.currentTarget.value)}>
  </div>

  <div class="rail__part rail__grow">
    <h2>{t('filter_collections')}</h2>
    <div class="collections" id="rows" bind:this={rows}></div>
    <button id="newcol" class="btn quiet sm" onclick={() => void make()}>{t('collection_new')}</button>
  </div>

  <div class="rail__foot">
    <button id="gear" class="flat" onclick={showSettings}>{t('settings')}</button>
  </div>
</aside>
