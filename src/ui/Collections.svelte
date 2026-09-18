<script lang="ts">
  /**
   * The list of Sammlungen in the sidebar: which exist, which one you are in,
   * and making one.
   *
   * A Sammlung is a place you work in, not a label a sentence happens to carry.
   * Clicking one opens it; Cmd or Ctrl adds a second, because working across
   * two of them at once is a real thing to be doing, and that has to be
   * reachable. §4.2, which is about the open set and not about how many
   * Sammlungen a sentence is in.
   *
   * ## This was Rail.svelte, and what is left of it is the list
   *
   * The column around it — the `<aside>`, the brand row, the drawer's `✕`, the
   * foot — is `@lautstark/design/svelte/Sidebar` now (conventions.md §6.3), and
   * App.svelte is where it is assembled. What could not go with it is exactly
   * this: the component's `sections` seam is **one snippet**, and the product
   * draws its own `<h2>` and its own section wrappers inside it, because
   * bildhaft swaps the heading along with the list when a search is running.
   *
   * Whether the sidebar is on screen was never this file's and still is not: it
   * is two separate questions — a drawer dismissed on a phone, a column put
   * away on a laptop — and both are answered a level up.
   */
  import { drawCollections } from '@lautstark/design/collections';
  import { createCollection } from '../db/repo.ts';
  import { ALL, DECLARED, OPEN, load, nameCaret, openAlso, openOnly } from './store.svelte.ts';
  import { lang, t } from './words.svelte.ts';
  import { say } from './dom.ts';

  let { dismiss }: {
    /** Put the drawer away. Does nothing where the sidebar is a column of the
     *  page — choosing a Sammlung dismisses the layer, because it is in the way
     *  of the thing that was just asked for (§3.1). */
    dismiss: () => void;
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
     flag — §4.2 — and that did not change when arity did, nor when the column
     around this list became a shared component: `open` and `onPick` are props
     of that component's *row list*, not of its shell, and §6.3 leaves both with
     the product for exactly this reason.

     `openAlso` toggles rather than adds, so Cmd-clicking a Sammlung that is
     already open closes it. That is the behaviour §4.2 records and is not a
     thing to converge with the two products that ignore the flag.

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
    /* Straight into the name, selected: typing replaces the date it was given.
       The caret is *asked for* rather than moved — conventions.md §6.5, and
       `nameCaret` in the store says why. This used to be a `nameNew` prop
       whose one implementation reached an exported method on WorkHead through
       App, which made the thing that creates a Sammlung responsible for
       knowing which component draws its name. */
    nameCaret.ask();
  }
</script>

<div class="sidebar__part sidebar__grow">
  <h2>{t('filter_collections')}</h2>
  <div class="collections" id="rows" bind:this={rows}></div>
  <button id="newcol" class="btn quiet sm" onclick={() => void make()}>{t('collection_new')}</button>
</div>
