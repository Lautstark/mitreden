<script lang="ts">
  /**
   * The sentences: what is in the Sammlung you are in.
   *
   * A sentence or a whole Sammlung, nothing in between. There is no selection
   * model: an act is either on the one you clicked or on all of them, and the
   * whole-Sammlung acts are in the head above this.
   */
  import { CAP, shown, showAll, showingAll, searching } from './store.svelte.ts';
  import { t } from './words.svelte.ts';
  import Item from './Item.svelte';

  let items = $derived([...shown()].reverse());          // newest first
  let drawn = $derived(showingAll() ? items : items.slice(0, CAP));
</script>

<div id="list">
  {#if !items.length}
    <!-- "Nothing matches" is only true when something is narrowing the list. An
         empty Sammlung is not a failed search. -->
    {#if searching()}
      <p class="empty">{t('empty_no_match')}</p>
    {:else}
      {@const [before, after] = t('empty_start').split('{key}')}
      <p class="empty">{before ?? ''}<kbd>Enter</kbd>{after ?? ''}</p>
    {/if}
  {:else}
    {#each drawn as item (item.id)}
      <Item {item} />
    {/each}
    {#if !showingAll() && items.length > CAP}
      <button class="btn more" onclick={showAll}>{t('show_all', { n: items.length })}</button>
    {/if}
  {/if}
</div>
