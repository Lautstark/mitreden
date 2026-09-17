<script lang="ts">
  /**
   * The page: the rail, the work beside it, and the three sheets.
   *
   * This is what index.html used to be — 370 lines of static markup that a
   * dozen modules reached into by id — and what main.ts's five `wireX()` calls
   * used to attach to it. There is nothing to wire: a component brings its own
   * handlers, and what is left here is the handful of facts that are about the
   * *page* rather than about any one part of it — whether the rail is up,
   * whether a sheet is open, and which page the footer asked for.
   *
   * ## Why the rail and the topbar are not inside <main>
   *
   * `main` is the work column — 720px, centred, with the footer pinned to its
   * foot — and the rail is a fixed column beside it. index.html mounts this
   * into a `<div id="app">` carrying `display: contents`, so the four siblings
   * below land in the body's flex layout exactly as they did when they were
   * written out there by hand. The wrapper contributes no box, the stylesheet
   * did not have to learn a new name for the column, and `<main>` still means
   * the sentences rather than the sentences plus the sidebar. wochenwerk mounts
   * into a `<main id="app">` because over there the app *is* one column; here
   * that would have moved the landmark.
   */
  import { saveSidebarOpen, settings } from '../db/repo.ts';
  import { useStatusLine } from './dom.ts';
  import type { Page } from './info.ts';
  import { t } from './words.svelte.ts';
  import type { Sicherung } from '@lautstark/sicherung';
  import Rail from './Rail.svelte';
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

  /** On a phone the rail is a layer over the work; this is whether it is up. */
  let drawer = $state(false);

  /**
   * Whether the rail is a column of this page at all — bildhaft's question, and
   * kept for the same reason: on a laptop the sentences are the work and 268px
   * of Sammlungen is a permanent tax on the width they get. Remembered, because
   * a choice about the shape of the window is not one to make every visit.
   *
   * Only a desktop question. Narrow screens have no rail to collapse; they have
   * one to dismiss, which is what ✕ and the scrim already do — and
   * `@media (max-width:820px)` drops both `#railhide` and `.reveal` so the
   * remembered answer cannot follow somebody onto a phone.
   *
   * Kept in the settings record with every other preference, not in
   * localStorage — conventions.md §1.3. The scheme and the language are still
   * in localStorage and that is not an inconsistency: both have to be readable
   * before the first paint or the page flashes and corrects itself. This one is
   * allowed to arrive a frame late, which is the whole of the difference.
   */
  let railed = $state(false);

  const collapse = (on: boolean): void => {
    railed = on;
    void saveSidebarOpen(!on);
  };

  /* What it was set to last time. Absent means open: a rail nobody has put away
     is there, and a first visit should not have to say so. Not through
     collapse(), which would write back what it has just read. */
  void settings().then((saved) => { railed = saved.sidebarOpen === false; });

  let info = $state<Page | null>(null);
  let setup = $state(false);
  let collectionVoice = $state<string | null>(null);

  let head: ReturnType<typeof WorkHead>;
  let status: HTMLElement;

  /* `body.railed` is what the stylesheet switches on: the work gets the rail's
     268px back and re-centres into it, and the rail slides out. A class on the
     body rather than on anything here, because the padding that changes is the
     body's own. */
  $effect(() => {
    document.body.classList.toggle('railed', railed);
  });

  /* The one node the drawing does not own: a live region has to be the same
     element for the life of the page. See ui/dom.ts. */
  $effect(() => {
    useStatusLine(status);
  });

  /** Below this the rail is a layer over the work, not a column beside it. */
  const narrow = (): boolean => matchMedia('(max-width:820px)').matches;
</script>

<!-- Narrow screens get a bar instead of a rail: the rail slides over the work
     rather than squeezing it, and the scrim closes it. mitreden is sold as
     usable from a phone, so this is not decoration. -->
<div class="topbar">
  <button id="railopen" class="btn quiet icon" aria-label={t('collections_show')}
    onclick={() => { drawer = true; }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  <h1><img class="logo" src="icon.svg" alt="" width="28" height="28">mitreden</h1>
</div>
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<!-- A scrim and not a button, as it was: it is the page behind the drawer, and
     the drawer's own ✕ is what a keyboard reaches for. -->
<div id="scrim" class="scrim" hidden={!drawer} onclick={() => { drawer = false; }}></div>

<!-- What brings the rail back once it is put away. It floats over the work in
     the corner the rail vacated, which is where bildhaft puts it and where the
     eye is already looking for it. -->
<div class="reveal" id="reveal" hidden={!railed}>
  <button id="railshow" class="btn quiet icon" aria-label={t('collections_show')}
    title={t('collections_show')} onclick={() => collapse(false)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  <img class="reveal__logo" src="icon.svg" alt="" width="22" height="22">
</div>

<Rail {drawer}
  dismiss={() => { if (narrow()) drawer = false; }}
  collapse={() => collapse(true)}
  showSettings={() => { setup = true; }}
  nameNew={() => head?.focusName()} />

<main>
  <Compose />
  <!-- role="status" is aria-live="polite", and the element is never hidden and
       never removed: a live region has to be in the accessibility tree already
       when the text lands, or the reader has nothing to notice a change in.
       Empty of children on purpose too — the announcer writes into it, and an
       expression that is currently the empty string is still a child, which is
       what `.status:empty` is written against. See ui/dom.ts. -->
  <p class="status" id="s" role="status" bind:this={status}></p>

  <WorkHead bind:this={head} showCollectionVoice={(id) => { collectionVoice = id; }} />
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
