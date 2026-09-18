<script lang="ts">
  /**
   * One sentence: what it says, whether it has a recording, and what you can do
   * to it.
   *
   * ## The player, and the reason this is a component at all
   *
   * The list used to rebuild every row on every change, which revoked the blob
   * URL under any `<audio>` currently playing. A batch of forty reports itself
   * one sentence at a time, so a redraw each time cut off a preview repeatedly
   * — for a change that amounts to one class and one word per row. The answer
   * was two extra paths: `repaintWork()`, which wrote the class and the state
   * text back into the existing nodes by query, and `landed()`, which rebuilt
   * exactly one row from fresh data and re-minted only its URL. Both are gone.
   * A keyed `{#each}` leaves this component standing, and the clip is fetched
   * against `fingerprint` — the thing that decides whether the stored audio is
   * still the audio for this sentence — so a row whose recording has not moved
   * keeps the URL it is playing.
   */
  import { getAudio } from '../db/audio.ts';
  import { asFormat } from '../core/audio.ts';
  import { build, deletePhrase, editPhrase } from '../db/repo.ts';
  import Overflow from '@lautstark/design/svelte/Overflow';
  import type { AddItem } from '@lautstark/design/menu';
  import { download } from '@lautstark/werkzeuge/download';
  import type { Format, PhraseWithState } from '../core/types.ts';
  import { endWork, load, queueWork, stepWork, workOn } from './store.svelte.ts';
  import { chosenVoice } from './voices.svelte.ts';
  import { confirmDialog } from './dialog.ts';
  import { t, tn } from './words.svelte.ts';
  import { busy, say } from './dom.ts';

  let { item }: { item: PhraseWithState } = $props();

  /* Spread rather than written out, because the DOM typings do not carry this
     one and it is real: it keeps the clip off a Chromecast, which is not what
     somebody checking a recording wants it to do. */
  const NO_CAST: Record<string, string> = { disableRemotePlayback: '' };

  /** Two facts about one sentence: whether it has a recording, and whether one
   *  is being made for it now. */
  let work = $derived(workOn(item.id));
  let className = $derived(`item ${item.state}${work ? ` busy ${work}` : ''}`);

  /**
   * Every row names its own voice, so the word "recorded" would be true of all
   * of them and say nothing. Either it is not recorded, or you get the voice —
   * and before either of those, whether it is being recorded right now.
   *
   * Here rather than in the store, which holds what is true and no words for
   * it. It also keeps the store free of the words table, which is what lets
   * tests/unit/shelf.test.ts go on mocking `src/i18n/index.ts` down to `t`.
   */
  let saying = $derived(work
    ? t(work === 'recording' ? 'state_recording' : 'state_queued')
    : item.state === 'missing' ? t('state_missing')
      : item.state === 'stale' ? t('state_stale')
        : item.voice ?? t('state_recorded'));

  /* What the stored clip is *of*. A `$derived` rather than a read inside the
     effect: the sentences are replaced whole on every reload, so `item` is a
     different object several times a minute while a batch runs, and an effect
     depending on the object would refetch — and revoke — on each of them. A
     derived string only wakes what reads it when the string itself moves. */
  let clip = $derived(item.state === 'missing' ? '' : `${item.id}:${item.fingerprint ?? ''}:${item.state}`);
  let url = $state('');
  let fetched = '';

  $effect(() => {
    const wanted = clip;
    if (wanted === fetched) return;
    fetched = wanted;
    const stale = url;
    url = '';
    if (stale) URL.revokeObjectURL(stale);
    if (!wanted) return;
    void getAudio(item.id).then((blob) => {
      // Only if nothing has moved on since this was asked for.
      if (!blob || fetched !== wanted) return;
      url = URL.createObjectURL(blob);
    });
  });

  /* The row is leaving, so its URL goes with it. This was a Map in the list and
     a loop at the top of every draw; it is the one line the browser gives you
     for free once a row owns its own clip. */
  $effect(() => () => { if (url) URL.revokeObjectURL(url); });

  let line: HTMLElement;

  /* Built each time the menu opens, which is what `Overflow` calls this for:
     the items follow what is true of this row now rather than what was true
     when it was drawn. */
  function menu(add: AddItem): void {
    if (item.state !== 'missing') {
      add(t('download_mp3'), () => void grab('mp3'));
      add(t('download_wav'), () => void grab('wav'));
    }
    /* Not only when the recording is missing. A stale row has a clip that
       plays and says „geändert seit der Aufnahme", and until now the only way
       to act on that was to retype the sentence — which was a small gap when
       the voice was the sentence's own and is not one now: changing a
       Sammlung's voice makes every row in it stale at once, and a state
       nothing can leave is a state that should not have been reachable. The
       Sammlung's own ⋯ does all of them; this does the one you are looking
       at. */
    if (item.state !== 'ok') add(t('menu_record'), () => void again());
    add(t('menu_delete_one'), () => void remove(), { danger: true });
  }

  async function again(): Promise<void> {
    busy('busy_record');
    queueWork([item.id]);
    const { failed } = await build([item.id], chosenVoice(), false, stepWork);
    endWork();
    say(failed.length ? tn('not_recorded', failed.length, { why: failed[0]! })
      : t('done_edit', { text: item.text }));
    await load();
  }

  async function grab(format: Format): Promise<void> {
    const stored = await getAudio(item.id);
    if (!stored) {
      say(t('nothing_recorded'));
      return;
    }
    // The id is already a file name — core/ids.ts made it one, and the file it
    // names may be on a talker — so it goes out as it stands.
    download(await asFormat(stored, format), `${item.id}.${format}`);
  }

  async function remove(): Promise<void> {
    if (!await confirmDialog({
      title: t('menu_delete_one'),
      body: t('ask_delete_this', { text: `„${item.text}“` }),
      confirmLabel: t('delete_one_do'),
      danger: true,
    })) return;
    busy('busy_delete');
    await deletePhrase(item.id);
    say(t('done_delete_one', { text: item.text }));
    await load();
  }

  /**
   * Editing happens on the sentence, the same way a Sammlung is renamed by
   * typing in its title. Clicking away commits and records again; Escape puts
   * the old text back. The id never moves — it is a file name, and the file may
   * already be on a device.
   *
   * The text node is the component's and the caret is the browser's, so this is
   * the one place that writes to the DOM directly. It is safe because nothing
   * repaints this line while it is being typed in: `item.text` cannot move
   * until the write below lands.
   */
  function editLine(): void {
    if (line.isContentEditable) return;
    line.contentEditable = 'plaintext-only';
    line.spellcheck = false;
    line.focus();
    const range = document.createRange();
    range.selectNodeContents(line);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const stop = () => {
      line.contentEditable = 'false';
      line.onblur = null;
      line.onkeydown = null;
    };
    line.onkeydown = (event) => {
      if (event.key === 'Escape') { line.textContent = item.text; stop(); line.blur(); }
      if (event.key === 'Enter') { event.preventDefault(); line.blur(); }
    };
    line.onblur = async () => {
      const text = line.textContent?.trim() ?? '';
      stop();
      if (!text || text === item.text) { line.textContent = item.text; return; }
      busy('busy_record');
      const changed = await editPhrase(item.id, text);
      if (!changed) { line.textContent = item.text; return; }
      queueWork([item.id]);
      // The Sammlung's voice decides, so there is nothing to pass but the last
      // resort. `true` is "record it again even though the fingerprint matches"
      // — which it will not, the text having just changed — and no longer "in
      // this voice regardless".
      const { failed } = await build([item.id], chosenVoice(), true, stepWork);
      endWork();
      say(t('done_edit', { text: changed.text })
        + (failed.length ? ` ${tn('not_recorded', 1, { why: failed[0]! })}` : ''));
      await load();
    };
  }
</script>

<div class={className} data-id={item.id}>
  <div class="txt">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <!-- The sentence itself, and pressing it is what makes it editable — the
         same gesture that renames a Sammlung by typing in its title. A <button>
         here would be a button you cannot put a caret in, and the class is what
         `.item .line` in the stylesheet and the suite both name. -->
    <div class="line" bind:this={line} title={t('menu_edit_text')} onclick={editLine}>{item.text}</div>
    <!-- aria-busy, not an announcement. The visible marker is a coloured dot
         and somebody reading the page needs the same fact — but a batch of
         forty reporting itself one sentence at a time through the live region
         would bury the message that actually matters at the end. -->
    <div class="meta"><span class="st" aria-busy={work !== null}><span class="dot"></span><span class="state">{saying}</span></span></div>
  </div>
  {#if item.state !== 'missing'}
    <!-- The player's own ⋮ offers a playback speed that changes only listening,
         and a download of the preview rather than the file a device gets. Both
         mislead, so both are off. -->
    <audio controls controlsList="nodownload noplaybackrate" {...NO_CAST} preload="none" src={url || undefined}></audio>
  {/if}
  <!-- @lautstark/design/svelte/Overflow, conventions.md §6.10. The ARIA was
       already in the markup here rather than added at open, so what this brings
       is the deduplication and vorlaut's collision handling — the flip upwards
       and the height cap, which this trigger did not have and which is what a
       row near the foot of a long list wants.

       `.dots` rather than the component's `.btn.quiet.icon` default, and it is
       the one trigger in the family that is not a `.btn`. It stays: this is an
       inline control inside a dense row, beside an `<audio>`, and
       src/styles/app.css already writes down `.flat`, `.dots` and
       `.item .collection` as this page's three quiet inline controls sharing
       one transition. `.btn.quiet.icon` is a pill; `.dots` is a box with a 9px
       corner, its own padding and an 18px glyph, and switching it would change
       every row in the list. It is also in no baseline, so that change would happen
       with nothing watching it — which is the wrong thing to smuggle into a
       commit whose whole point is that nothing moves. §6.10 has a `class` prop
       for exactly this: a product that draws its ⋯ differently says so here
       rather than wrapping the component. -->
  <Overflow class="dots" label={t('more_actions')} build={menu} />
</div>
