<script lang="ts">
  /**
   * The page: the sidebar, the work beside it, and the three sheets.
   *
   * This is what index.html used to be — 370 lines of static markup that a
   * dozen modules reached into by id — and what main.ts's five `wireX()` calls
   * used to attach to it. There is nothing to wire: a component brings its own
   * handlers, and what is left here is the handful of facts that are about the
   * *page* rather than about any one part of it — whether the sidebar is up,
   * whether a sheet is open, and which page the footer asked for.
   *
   * ## The shell is @lautstark/design's, in four pieces
   *
   * conventions.md §6.3. `Sidebar` is the column, `Scrim` the page behind the
   * drawer, `Reveal` what brings a put-away column back, and `TopBar` the bar a
   * narrow screen gets instead of a column. They are assembled here rather than
   * in one component of this product's because three of the four already lived
   * here: the drawer, the collapse and the sheets are page facts, and the only
   * part that was ever elsewhere is the list of Sammlungen, which is
   * Collections.svelte and goes in the `sections` snippet.
   *
   * What the components add that this page did not have: `aria-expanded` and
   * `aria-controls` on every control that shows or hides the column, an
   * accessible name on the `<aside>`, a scrim a keyboard can reach, and a
   * breakpoint that is a **live** `matchMedia` rather than a number read at the
   * moment of a press. What they deliberately do not take is anything a product
   * varies — the placement, the width, every `z-index` — and one thing no
   * component can take: `--sidebar-w` is consumed by a rule on `<body>`, and no
   * component owns the body. That token stays this product's, in app.css.
   *
   * Two more arrived at design v1.38.0 rather than with the adoption, and the
   * gap is worth keeping written down: §6.3 promised four things and the first
   * build shipped only the ARIA, which is markup. Escape and the focus round
   * trip both needed code, and this page did not write them — a mitreden-local
   * copy of shared behaviour is the divergence the extraction exists to end, so
   * the fix went into the component and came back through the pin. The drawer
   * answers Escape and takes focus to its `✕`, and hands focus back to whatever
   * opened it; above 820px neither applies, because up here the column covers
   * nothing and Escape belongs to whatever the person is working in.
   * e2e/mobile.spec.ts holds the two, e2e/app.spec.ts the third.
   *
   * ## Why the sidebar and the topbar are not inside <main>
   *
   * `main` is the work column — 720px, centred, with the footer pinned to its
   * foot — and the sidebar is a fixed column beside it. index.html mounts this
   * into a `<div id="app">` carrying `display: contents`, so the four siblings
   * below land in the body's flex layout exactly as they did when they were
   * written out there by hand. The wrapper contributes no box, the stylesheet
   * did not have to learn a new name for the column, and `<main>` still means
   * the sentences rather than the sentences plus the sidebar. wochenwerk mounts
   * into a `<main id="app">` because over there the app *is* one column; here
   * that would have moved the landmark.
   */
  import Sidebar from '@lautstark/design/svelte/Sidebar';
  import Scrim from '@lautstark/design/svelte/Scrim';
  import Reveal from '@lautstark/design/svelte/Reveal';
  import TopBar from '@lautstark/design/svelte/TopBar';
  import { narrow } from './sidebar.ts';
  import { saveSidebarOpen, settings } from '../db/repo.ts';
  import { useStatusLine } from './dom.ts';
  import type { Page } from './info.ts';
  import { ask, asked } from './store.svelte.ts';
  import { t } from './words.svelte.ts';
  import type { Sicherung } from '@lautstark/sicherung';
  import Collections from './Collections.svelte';
  import Compose from './Compose.svelte';
  import WorkHead from './WorkHead.svelte';
  import List from './List.svelte';
  import Footer from './Footer.svelte';
  import InfoSheet from './InfoSheet.svelte';
  import SetupSheet from './SetupSheet.svelte';
  import CollectionVoice from './CollectionVoice.svelte';

  /* The standing backup, made in main.ts because a unit test reads that file to
     check what it is handed, and passed through to the one panel that draws
     it. */
  let { backup }: { backup: Sicherung } = $props();

  /** On a phone the sidebar is a layer over the work; this is whether it is up.
   *  A moment rather than a preference — closing the tab closes it. */
  let drawer = $state(false);

  /**
   * Whether the sidebar is a column of this page at all — bildhaft's question,
   * and kept for the same reason: on a laptop the sentences are the work and
   * 268px of Sammlungen is a permanent tax on the width they get. Remembered,
   * because a choice about the shape of the window is not one to make every
   * visit.
   *
   * Only a desktop question. Narrow screens have no column to collapse; they
   * have a drawer to dismiss, which is what the `✕` and the scrim already do —
   * `Reveal` drops itself below the breakpoint and `@media (max-width:820px)`
   * drops `#sidebarhide`, so the remembered answer cannot follow somebody onto
   * a phone. `Sidebar` makes the same guarantee from the other side: it
   * *ignores* this below the breakpoint rather than consulting it.
   *
   * Kept in the settings record with every other preference, not in
   * localStorage — conventions.md §1.3. The scheme and the language are still
   * in localStorage and that is not an inconsistency: both have to be readable
   * before the first paint or the page flashes and corrects itself. This one is
   * allowed to arrive a frame late, which is the whole of the difference.
   */
  let collapsed = $state(false);

  /**
   * Which arrangement is actually on screen, bound out of `Sidebar` — it is
   * `narrow ? drawer : !collapsed`, computed against the live breakpoint. Read
   * rather than recomputed here, so the bar's `aria-expanded` and the column
   * cannot disagree about what a press would do.
   */
  let showing = $state(false);

  const collapse = (on: boolean): void => {
    collapsed = on;
    void saveSidebarOpen(!on);
  };

  /* What it was set to last time. Absent means open: a sidebar nobody has put
     away is there, and a first visit should not have to say so. Not through
     collapse(), which would write back what it has just read. */
  void settings().then((saved) => { collapsed = saved.sidebarOpen === false; });

  let info = $state<Page | null>(null);
  let setup = $state(false);
  let collectionVoice = $state<string | null>(null);

  let status: HTMLElement;

  /* `body.collapsed` is what the stylesheet switches on: the work gets the
     sidebar's 268px back and re-centres into it, and the column slides out. A
     class on the body rather than on anything here, because the padding that
     changes is the body's own — which is also why `Sidebar` cannot own it.

     The rules it drives stay inside `@media (min-width:821px)`, and that is
     load-bearing rather than tidy: `body.collapsed .sidebar` is 0-2-1 and
     out-specifies `.sidebar.open` at 0-2-0, so lifted out of the media query it
     would keep the drawer off screen on a phone for anybody who had collapsed
     the column on a laptop. e2e/mobile.spec.ts is the test that says so. */
  $effect(() => {
    document.body.classList.toggle('collapsed', collapsed);
  });

  /* The one node the drawing does not own: a live region has to be the same
     element for the life of the page. See ui/dom.ts. */
  $effect(() => {
    useStatusLine(status);
  });

  /** Choosing a Sammlung dismisses the layer, because it is in the way of the
   *  thing that was just asked for (§3.1). Nothing to dismiss on a desktop. */
  const dismiss = (): void => { if (narrow()) drawer = false; };
</script>

<!-- Narrow screens get a bar instead of a column: the sidebar slides over the
     work rather than squeezing it, and the scrim closes it. mitreden is sold as
     usable from a phone, so this is not decoration. The bar is a <header> and
     so a banner landmark, which this page did not have. -->
<TopBar
  buttonId="sidebaropen"
  controls="sidebar"
  expanded={showing}
  label={t('collections_show')}
  title={t('collections_show')}
  onreveal={() => { drawer = true; }}
>
  {#snippet icon()}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>{/snippet}
  {#snippet brand()}<h1><img class="logo" src="icon.svg" alt="" width="28" height="28">mitreden</h1>{/snippet}
</TopBar>

<!-- The page behind the drawer, and a second way out of it. It was a <div> here
     and the comment beside it argued for one: the drawer's own ✕ is what a
     keyboard reaches for, and this page draws that ✕ on narrow. §6.3 keeps the
     argument and overrules it on consistency — one of the three products had to
     move, and a focusable <button> moves the fewest things. The cost is real
     and the component pays it: a bare <button> at inset:0 with border-box takes
     the user agent's `border: 2px outset ButtonBorder` and draws a frame around
     the whole viewport, so the component's scoped rule resets `border`. The
     rule this file keeps is the z-index and the resize guard; see app.css. -->
<Scrim
  id="scrim"
  label={t('collections_hide')}
  shown={drawer}
  ondismiss={() => { drawer = false; }}
/>

<!-- What brings the column back once it is put away. It floats over the work in
     the corner the sidebar vacated, which is where bildhaft puts it and where
     the eye is already looking for it. The remembered preference rather than
     `showing`: this is a column question, and the component drops itself below
     the breakpoint where that question does not apply. -->
<Reveal id="reveal" controls="sidebar" shown={collapsed}>
  {#snippet brand(wired)}
    <button id="sidebarshow" class="btn quiet icon" {...wired}
      aria-label={t('collections_show')} title={t('collections_show')}
      onclick={() => collapse(false)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <img class="reveal__logo" src="icon.svg" alt="" width="22" height="22">
  {/snippet}
</Reveal>

<Sidebar
  id="sidebar"
  label={t('filter_collections')}
  closeId="sidebarclose"
  closeLabel={t('collections_hide')}
  {drawer}
  {collapsed}
  bind:showing
  ondismiss={() => { drawer = false; }}
>
  <!-- The collapse control is the product's, because bildhaft's lives inside
       its brand row and a component-owned chevron and a product-owned brand
       cannot both be true. What the component hands over is the half that is
       about an element in there: `aria-controls` and `aria-expanded`. The ✕
       beside it is the component's, and is drawn below the breakpoint only —
       up here there is a column and nothing to dismiss. -->
  {#snippet brand(wired)}
    <h1><img class="logo" src="icon.svg" alt="" width="34" height="34">mitreden</h1>
    <button id="sidebarhide" class="btn quiet icon" {...wired}
      aria-label={t('collections_hide')} title={t('collections_hide')}
      onclick={() => collapse(true)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
  {/snippet}

  <!-- Its own snippet rather than the first thing in `sections`, which is the
       seam doing its job: the field sits above whatever a search replaces and
       must not be swapped out with it. The wrapper is this product's name for
       it — the component renders the snippet bare, because the two products
       that have a search field call that wrapper different things. -->
  {#snippet search()}
    <div class="sidebar__part">
      <input id="q" class="field" type="search" placeholder={t('search_hint')} autocomplete="off"
        value={asked()} oninput={(event) => ask(event.currentTarget.value)}>
    </div>
  {/snippet}

  {#snippet sections()}
    <Collections {dismiss} />
  {/snippet}

  <!-- Einstellungen at the foot, §3.2. `.flat` rather than the `.btn.quiet.sm`
       the other two products use, and it stays: „Neue Sammlung" 20px above it
       *is* a `.btn.quiet.sm`, so giving this one the same class would draw the
       way out of the page at the same weight and the same shape as the last
       thing to do inside it. app.css says the rest. -->
  {#snippet foot()}
    <button id="gear" class="flat" onclick={() => { setup = true; }}>{t('settings')}</button>
  {/snippet}
</Sidebar>

<main>
  <Compose />
  <!-- role="status" is aria-live="polite", and the element is never hidden and
       never removed: a live region has to be in the accessibility tree already
       when the text lands, or the reader has nothing to notice a change in.
       Empty of children on purpose too — the announcer writes into it, and an
       expression that is currently the empty string is still a child, which is
       what `.status:empty` is written against. See ui/dom.ts. -->
  <p class="status" id="s" role="status" bind:this={status}></p>

  <WorkHead showCollectionVoice={(id) => { collectionVoice = id; }} />
  <List />

  <!-- The page is the whole program now, so it has to say what it is and what
       it does with what you type. Both are one line; neither belongs in a
       dialog nobody opens. -->
  <Footer show={(page) => { info = page; }} />
</main>

<!-- The three sheets. Closed, a <dialog> is display:none and open it is in the
     top layer, so where they sit in the document decides nothing — which is why
     they are out of the work column rather than in it, where the markup used to
     keep them. -->
<InfoSheet bind:page={info} />
<SetupSheet bind:open={setup} {backup} />
<CollectionVoice bind:showing={collectionVoice} />
