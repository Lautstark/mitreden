<script lang="ts">
  /**
   * Typing a sentence, and which voice records it.
   *
   * Enter records; Shift + Enter is a new line. Several lines at once each
   * become their own sentence, because that is how a set of them gets written
   * down.
   *
   * The voice is not chosen here. A picker beside the composer invited it to be
   * re-decided per sentence, which is not what it does. What is left is the
   * sentence: which voice is in force, and nothing to press.
   */
  import { addPhrases, build } from '../db/repo.ts';
  import { setProgress } from '../core/audio.ts';
  import { endWork, load, queueWork, stepWork } from './store.svelte.ts';
  import { chosenVoice, nextCollection, voiceById, voiceInForce } from './voices.svelte.ts';
  import { sourceOf, speaks, t, tn } from './words.svelte.ts';
  import { busy, say } from './dom.ts';

  let typed = $state('');

  /**
   * What the next recording will sound like, in the three facts that decide it:
   * the voice's name, who renders it, and what it speaks. The last two were
   * missing, and a picker of forty names with nothing to tell them apart is a
   * list you scroll rather than choose from.
   *
   * And a fourth, added when the voice moved onto the Sammlung: *whose* voice
   * this is. The sentence was true before because there was one answer; there
   * are two now — this Sammlung's, or the default an uncollected sentence
   * records in — and a line naming a voice without saying which of the two it
   * read is a line that is right by luck.
   *
   * That fourth fact used to do double duty, as the caption that made one
   * „Ändern" button leading to two different places honest. The button went on
   * 2026-08-29 and the fact stays, because it was always the more useful half:
   * it answers "which voice is this" without anybody pressing anything.
   */
  let into = $derived(nextCollection());
  let voice = $derived(voiceById(voiceInForce()));

  async function add(): Promise<void> {
    const lines = typed.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      say(t('type_first'));
      return;
    }
    /* A sentence goes into the Sammlung you are in. There is nothing to decide:
       you opened one, you typed, it belongs there. With several open it goes in
       uncollected — guessing which of two you meant would be worse than asking
       — and an uncollected sentence records in the settings voice, which is the
       same answer a Sammlung without one gets. */
    const where = into;
    busy('busy_add');
    const { added, merged, ids } = await addPhrases(lines, where);
    typed = '';
    /* Show them before recording them. Waiting for the voice to exist before
       drawing the row is how the list stays empty through a model download.
       They are marked as being worked on before the draw, or every one of them
       appears saying "noch nicht aufgenommen" — true, and the opposite of what
       is happening to it. */
    queueWork(ids);
    await load();
    if (!ids.length) { endWork(); return; }
    setProgress((percent) => busy('busy_model', { percent }));
    const { recorded, failed } = await build(ids, chosenVoice(), false, stepWork);
    setProgress(null);
    endWork();
    say(t('done_add', { added, rendered: recorded })
      + (merged ? t('done_add_twins', { n: merged }) : '') + '.'
      + (failed.length ? ` ${tn('not_recorded', failed.length, { why: failed[0]! })}` : ''));
    await load();
  }
</script>

<div class="compose">
  <textarea id="t" placeholder={t('new_phrases_hint')} bind:value={typed}
    onkeydown={(event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void add();
      }
    }}></textarea>
  <button class="send" id="add" aria-label={t('add_phrase')} title={t('add_phrase')}
    onclick={() => void add()}>→</button>
</div>
<p class="chint">
  <span><kbd>Enter</kbd> <span id="chint1">{t('compose_records')}</span> ·
    <kbd>Shift</kbd> + <kbd>Enter</kbd> <span id="chint2">{t('compose_newline')}</span></span>
  <!-- Not a control: a statement of which voice the next recording gets, and
       only that. The two doors are where they belong — a Sammlung's voice is in
       its own ⋯ menu, the default is in Einstellungen — so this line does not
       route anywhere and there is nothing left to keep in step with it.

       Written from here rather than carried by a words table, because what it
       says depends on where the next sentence lands: this Sammlung's voice, or
       the default an uncollected sentence records in. -->
  <!-- Laid out with room between the tags, unlike the caption above it: this
       span is a flex container, so the whitespace between its children is not
       a text node anybody can see. Inside the caption it would be. -->
  <span class="right voicenow">
    <span class="voicenow__what" id="voicewhat">{t(into ? 'voice_label_collection' : 'voice_label_default')}</span>
    <b id="voicename">{voice?.label ?? '—'}</b>
    <!-- The language, not the locale. "Englisch (Vereinigte Staaten)" is the
         honest answer and it is also the one that pushed this line onto a row
         of its own; the region only separates two voices when both are
         offered, which is a question for the picker, where there is room to
         ask it. -->
    <span class="voicenow__from" id="voicefrom">{voice ? `${sourceOf(voice.source)} · ${speaks(voice.lang)}` : ''}</span>
  </span>
</p>
