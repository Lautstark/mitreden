<script lang="ts">
  /**
   * The list of voices, and which of them a particular thing is set to.
   *
   * The list itself is `@lautstark/stimmquelle/voice-picker` — one module for
   * the surface mitreden, vorlaut-editor and wochenwerk had each drawn
   * separately, with the same five class names and three different drawings. It
   * is plain DOM, like the family's other shared panels, so it is built once
   * per instance and hosted in a Vanilla.
   *
   * ## Two instances, and never one
   *
   * There are two — what this Sammlung records in, and what a new Sammlung
   * starts with — and they are different questions about the same catalogue, so
   * each gets its own picker rather than a pair of copies that drift.
   *
   * A shared instance would have been cheaper and wrong: the query and the
   * language filter are somebody's place in a list of hundreds, and carrying a
   * search for „kerstin" out of one dialog into the other would look like the
   * second one had lost most of its voices. The module holds that state per
   * `voicePicker()` call, and this being a component is what keeps the rule —
   * two tags are two pickers, and nothing has to remember why.
   *
   * `hear` is not passed: this page speaks a voice by recording with it, which
   * is minutes of synthesis and a file, and there is nothing here that plays a
   * sample. So no `▶` is drawn — the module draws the row wrapper either way,
   * so the day this page grows a sample player nothing else moves.
   */
  import { onDestroy } from 'svelte';
  import { voicePicker, type VoicePicker } from '@lautstark/stimmquelle/voice-picker';
  import { knownVoices } from '../voices.svelte.ts';
  import { lang } from '../words.svelte.ts';
  import Vanilla from './Vanilla.svelte';

  let { current, pick }: {
    /** What this list is choosing for, read at draw time rather than passed in:
     *  the Sammlung's sheet draws for a different Sammlung each time. */
    current: () => string | undefined;
    pick: (id: string) => void;
  } = $props();

  const picker: VoicePicker = voicePicker({
    // Read on every paint rather than passed once: an Azure key saved in the
    // sheet the picker is standing in adds several hundred rows to it.
    voices: knownVoices,
    /* Called through rather than handed over: a prop read at construction is
       the value it had then, and the Sammlung's sheet hands this a different
       `current` each time it opens. */
    current: () => current(),
    pick: (id) => pick(id),
    // A function, because this page changes language without reloading — the
    // row that does it is in the panel directly above this one. A locale
    // captured at build time would go on answering in the language the reader
    // has just left, perfectly well-formed the whole time.
    lang,
  });

  /* The module repaints when it is told to, not when a rune moves, so this is
     the seam between the two. Reading the catalogue, the answer and the
     language here is what signs the picker up for all three. */
  $effect(() => {
    void knownVoices();
    void current();
    void lang();
    picker.refresh();
  });

  /* It subscribes to nothing today and its `dispose` is a no-op, but the sheets
     these stand in are components now rather than markup that outlives the
     page, so the handle is disposed where the component goes. */
  onDestroy(() => picker.dispose());
</script>

<Vanilla node={picker.node} />
