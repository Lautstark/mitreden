<script lang="ts">
  /**
   * What one Sammlung records in, in the one place it can be said without
   * ambiguity: a sheet opened from the ⋯ beside its name.
   *
   * The voice moved onto the Sammlung (core/types.ts, `Collection.voice`) and
   * the screens went on offering it in Einstellungen, where the answer would
   * have changed with whichever Sammlung was open — which conventions.md §3.10
   * states as the test rather than as a list: *a setting whose answer changes
   * with the selection is not the app's*. §3.6, amended the same day, is the
   * other half: the ⋯ holds what a Sammlung is set to as well as what can be
   * done to it, because both are answered by *which* Sammlung the menu is
   * beside.
   *
   * ## Why this is a sheet and not a panel in one
   *
   * vorlaut's `docs/sammlung-settings.md` builds its equivalent as §3.5's
   * column of folded panels, one open at a time, because a talker Sammlung has
   * two things to set — the language its device shows its own menu in, and the
   * voice. mitreden has one. A column of one folded panel is a heading you have
   * to open to reach the only thing behind it, which is the arrangement §3.5
   * exists to prevent rather than an instance of it. So the sheet is the panel:
   * the lead says whose voice this is, the list is open, and the cost sits
   * under it.
   *
   * ## Live apply, and no confirmation
   *
   * Picking writes and closes nothing, the way vorlaut's sheet does — there is
   * no Save and no Cancel, because a voice destroys nothing. Every clip in the
   * Sammlung stays exactly where it is; what changes is that they no longer
   * match what the Sammlung says it sounds like, which `stateOf` in db/repo.ts
   * reports as *geändert seit der Aufnahme* and the button at the foot undoes
   * by speaking them again. A confirmation would be asking permission for
   * something reversible while saying nothing about what it costs; the line
   * under the list says what it costs, in sentences, before the press.
   */
  import Sheet from '@lautstark/design/svelte/Sheet';
  import { saveCollectionVoice } from '../db/repo.ts';
  import { ALL, DECLARED, load } from './store.svelte.ts';
  import { chosenVoice, knownVoices } from './voices.svelte.ts';
  import { recordAgain } from './sammlung.ts';
  import { t, tn } from './words.svelte.ts';
  import { say } from './dom.ts';
  import VoicePicker from './pieces/VoicePicker.svelte';

  let { showing = $bindable() }: { showing: string | null } = $props();

  let current = $derived(DECLARED().find((one) => one.id === showing));

  /* How many sentences in this Sammlung are not in the voice it now says it
     speaks in — the ones a re-record would speak. Counted the same way
     `recordAgain` picks them, because a button that says „3 Sätze" and then
     records four is worse than no count at all. */
  let pending = $derived(
    showing ? ALL().filter((item) => item.collection === showing && item.state !== 'ok').length : 0,
  );

  async function choose(id: string): Promise<void> {
    const one = current;
    if (!one || !id || id === one.voice) return;
    await saveCollectionVoice(one.id, id);
    // The rows behind the sheet are what just changed — every one of them, from
    // recorded to changed-since — so this is a full reload rather than a redraw
    // of the list it was clicked in.
    await load();
    const picked = knownVoices().find((voice) => voice.id === id);
    // The page's status line is inert behind a modal, so this is not heard now.
    // It is read when the sheet closes, which is where the reader is looking
    // next; the row's own aria-checked is what reports the press itself.
    if (picked) say(t('voice_now_collection', { name: one.name, voice: picked.label }));
  }

  /* Closes first, then speaks. Every other press on this sheet is instant and
     leaves the sheet standing — vorlaut's rule, and the right one for a write
     that is over before the hand leaves the mouse. This one is minutes of
     synthesis that reports its progress in the page, and a modal over that
     progress is the one arrangement where somebody cannot see the thing they
     just started. */
  function speakAgain(): void {
    const id = showing;
    if (!id) return;
    showing = null;
    void recordAgain(id);
  }
</script>

<!-- A sheet rather than a column of folded panels (§3.5) because there is
     exactly one thing here to set. The frame is
     @lautstark/design/svelte/Sheet's since 2026-09-17; what that cost this
     dialog is the ✕'s tier, `.btn.quiet.icon` → `.btn.icon` (§6.1), and
     sammlungsstimme.png was re-recorded for it. Nothing else moved: the body
     was already a `.body`, so the region rule already reached it.

     **No foot snippet, and that is the assertion** —
     e2e/collection-voice.spec.ts expects `.foot` to have count 0, and the
     shared frame draws one only when a foot is given. The record button below
     is part of what this sheet is about and sits under the cost it names,
     which is why it was never in a foot to begin with.

     `open` is one-way for InfoSheet's reason: `showing` is a `string | null`
     and `bind:` cannot take a `$derived`.

     `closeId` rather than `nameParts`: design v1.35.0 gives the ✕ an id of its
     own, which is the prop ui/dialog.ts named as the fix, and this is the call
     site taking it. Nothing writes to the frame after the fact any more. -->
<Sheet
  id="colvoice"
  open={showing !== null}
  title={t('collection_voice_title')}
  closeLabel={t('close')}
  closeId="colvoiceclose"
  onclose={() => { showing = null; }}
>
  {#snippet head()}<h2 id="colvoicetitle">{t('collection_voice_title')}</h2>{/snippet}
  <p class="hint" id="colvoicelead">{current ? t('collection_voice_lead', { name: current.name }) : ''}</p>
  <div id="colvoices">
    <!-- The second picker, and a second instance on purpose: see
         pieces/VoicePicker.svelte.

         The voice in force, which is not always the Sammlung's own. A
         Sammlung with no `voice` records in the default — from a migration, a
         restored backup written before the field existed, or a first run —
         and marking nothing in the list would have the sheet contradicting
         the line outside it, which names that same voice as the one
         recording. So the inherited answer is shown as the answer; pressing
         it is what makes it this Sammlung's own, which is a real change and
         not a no-op, because the default can move afterwards and this
         Sammlung will no longer follow it. -->
    <VoicePicker current={() => current?.voice ?? chosenVoice()} pick={(id) => void choose(id)} />
  </div>
  <!-- The count is the Sammlung's, not the open set's: this sheet is about
       one of them however many are open beside it. -->
  <p class="hint" id="colvoicecost">{current
    ? (current.count ? tn('collection_voice_cost', current.count) : t('collection_voice_cost_empty'))
    : ''}</p>
  <!-- The act, at the foot of the thing that causes it. The button says how
       many it would speak, and is dead when that is none — vorlaut's grid
       button is the precedent for both: its label is chosen by what the press
       would do, not by what the panel is called. „Alles ist aufgenommen" on a
       disabled button is why it cannot be pressed, which a greyed „0 Sätze
       neu aufnehmen" would leave somebody to work out. -->
  <button id="colvoicerecord" class="btn primary sm" disabled={!pending}
    onclick={speakAgain}>{pending ? tn('collection_record', pending) : t('collection_record_none')}</button>
</Sheet>
