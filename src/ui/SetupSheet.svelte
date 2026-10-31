<script lang="ts">
  /**
   * Einstellungen: what this page is, which voice a new Sammlung starts with,
   * and where the work lives.
   *
   * ## Three panels, and the rule each one follows
   *
   * „Sprache & Aussehen", „Standardstimme" and „Deine Daten" — five panels
   * until 2026-10-31, when the language and the scheme became one panel and
   * Azure moved under the voices, the way bildhaft had just done it. The rule
   * is „Deine Daten"'s: one box that says how things stand, at most one button
   * where something is to be done, and the rest in a `⋯`, so a person who has
   * never heard of a Speech resource can still answer every question here.
   *
   * Each panel says what it holds in its own heading — which voice, which
   * language, how many sentences — so a look is enough and opening is a
   * decision. components.css's `.panel`, native `<details>`, and
   * `name="settings"` makes them one exclusive group — opening one closes the
   * rest — which is the platform's own accordion.
   * @lautstark/design conventions.md §3.5.
   *
   * ## The frame, and the one rule that had to come with it
   *
   * @lautstark/design/svelte/Sheet, whose `.sheet > .body` sets
   * `color: var(--text-dim)` and `font-size: 14px` — both **inherited**, so a
   * child combinator cannot protect what is under them, and the boxes two
   * other packages draw in here would shift with it. `#setup > .body` in
   * src/styles/app.css hands the inherited pair straight back.
   * conventions.md §6.1.
   *
   * ## The panels inside the panels
   *
   * Three blocks here are another repository's: @lautstark/sicherung's
   * `DatenPanel`, @lautstark/stimmquelle's `VoicePicker` and
   * `AzureConnection`. The repaint, the subscription and its teardown are the
   * framework's, and `lang` is a prop rather than a thunk read per paint
   * (conventions.md §6.8). The one still hosted in a `Vanilla` is the language
   * row: @lautstark/design ships no Svelte twin of `languagePicker`, and its
   * `langs.node.id = 'lang'` below is the last imperative seam in this file.
   */
  import { untrack } from 'svelte';
  import Panel from '@lautstark/design/svelte/Panel';
  import Sheet from '@lautstark/design/svelte/Sheet';
  import ThemePicker from '@lautstark/design/svelte/ThemePicker';
  import { readTheme, type Theme } from '@lautstark/design/theme';
  import { languagePicker, NAMES } from '@lautstark/design/language';
  import Vanilla from '@lautstark/design/svelte/Vanilla';
  import DatenPanel from '@lautstark/sicherung/svelte/DatenPanel';
  import type { Sicherung } from '@lautstark/sicherung';
  import AzureConnection, { type AzureConnectionWords } from '@lautstark/stimmquelle/svelte/AzureConnection';
  import type { AzureAccess } from '@lautstark/stimmquelle/svelte/AzurePanel';
  import VoicePicker from '@lautstark/stimmquelle/svelte/VoicePicker';
  import { ablage } from '../db/folder.ts';
  import { adoptFolder } from '../db/mirror.ts';
  import { saveAzure, settings } from '../db/repo.ts';
  import { probeAzure } from '../core/voices.ts';
  import { LANGS, type Lang } from '../i18n/index.ts';
  import { ALL, load } from './store.svelte.ts';
  import { chosenVoice, knownVoices, loadVoices, pickVoice, relangVoice } from './voices.svelte.ts';
  import { exportAll, importFile, wipeEverything } from './settings.ts';
  import { recordEverything } from './sammlung.ts';
  import { lang, setLang, sourceOf, speaks, t, tn, type Key } from './words.svelte.ts';
  import { say } from './dom.ts';

  let { open = $bindable(), backup }: { open: boolean; backup: Sicherung } = $props();

  /** What the two package panels are told the page is in. Their own tables hold
   *  German and English only, and this product has no third language. */
  const reading = $derived<'de' | 'en'>(lang() === 'en' ? 'en' : 'de');

  // ------------------------------------------------------------- das Falten

  /**
   * Which panel is unfolded, and why it is state rather than markup.
   *
   * `name="settings"` is the platform's own accordion, so opening one panel
   * makes the browser **remove another's `open` attribute directly** — Svelte
   * never sees it happen. A one-way prop would leave this record saying a
   * panel is open while the DOM says it is folded, and on the next attempt to
   * open it `set_attribute` would short-circuit against its own stale record
   * and write nothing. That is the silent bug conventions.md §6.2 was
   * rewritten for, and `bind:open` on every Panel below is the fix: each one
   * writes itself back from `ontoggle`, so this record is what the browser
   * actually did.
   */
  const PANELS = ['look', 'voice', 'data'];
  /** §3.11: Sprache & Aussehen first, and the only one open. */
  const OPENS_WITH = 'look';
  const arrival = (): Record<string, boolean> =>
    Object.fromEntries(PANELS.map((one) => [one, one === OPENS_WITH]));
  const folded = $state<Record<string, boolean>>(arrival());

  /**
   * §3.11 on **every** opening, which is where this product was out of
   * compliance.
   *
   * The sheet is mounted for the life of the page, so „open on arrival" is not
   * something the markup can say once and be done with: `open` was an
   * attribute set at mount and never re-folded, so opening Azure, closing the
   * sheet and opening it again gave you Azure open and Sprache folded — the
   * two things §3.11 says must not happen, in the one sheet it is about.
   *
   * A count of openings rather than the flag itself, which is vorlaut's
   * `foldEpoch()` shape: a sheet closed and opened again is two folds, and
   * keying the re-fold on a number says that where keying it on a boolean only
   * happens to.
   */
  let folds = $state(0);
  /* `untrack` on both writes, and for the same reason each time: `folds += 1`
     is a read as well as a write, and `folded[one] = …` goes through a state
     proxy. An effect that depends on what it assigns is a loop rather than a
     rule. */
  $effect(() => { if (open) untrack(() => { folds += 1; }); });
  $effect(() => {
    void folds;
    untrack(() => { for (const one of PANELS) folded[one] = one === OPENS_WITH; });
  });

  // ------------------------------------------------------------ die Sprache

  /**
   * Both languages, with the one in force pressed — the same row all three
   * products draw.
   *
   * The hand-built loop this replaced was the third copy of one control, and
   * the copies had drifted in the way copies do. What mitreden had written down
   * beside its own copy — that a language's name is not a translation, because
   * this is the control somebody reaches for when they *cannot read the
   * interface around it* — is the module's argument now, and `NAMES` is why the
   * buttons still say „Deutsch" and „English" on either page.
   *
   * `current` is `lang` itself rather than a value: the module reads it on every
   * repaint, which is what lets `choose` below move the pressed button.
   *
   * The label is deliberately not `t('panel_language')`, for two reasons that
   * agree. The one this page argues at length: this is the accessible name of
   * the one control whose whole case is that the page around it may be
   * unreadable, so it says both words and stays saying both. The one the API
   * settles: `refresh()` moves the pressed button and nothing else — the label
   * is set once, at construction — so a translated name would be the language
   * the reader has just left, every time, until a reload.
   */
  const langs = languagePicker({
    languages: LANGS,
    current: lang,
    choose: (code: string) => choose(code as Lang),
    label: 'Sprache / Language',
  });
  /* `#lang` is what this page calls the spot the row goes in and what the suite
     reaches for; where it sits and what it is called are the product's
     business, which is precisely what the module declines to decide. The id is
     on the row itself — as it was when a placeholder div was replaced by it —
     so `#lang` is the `.segmented` group and not a box around one. */
  langs.node.id = 'lang';

  /**
   * The words this page is in.
   *
   * What it used to be was this, plus six redraws: the picker, the scheme
   * labels, the headings, the Azure card, the backup panel and a reload. All
   * six are gone — five read `t()` while they drew, which is now a dependency,
   * and the sixth was the backup panel, whose `lang` is a prop since §6.8. The
   * two left are not components: the language row, which is still a node in a
   * `Vanilla`, and the voice, which is a guess about which language to read
   * aloud in rather than a word on the screen.
   */
  function choose(code: Lang): void {
    setLang(code);
    localStorage.setItem('mitreden.lang', code);
    langs.refresh();
    relangVoice();
    void load();
  }

  // -------------------------------------------------------------- das Thema

  /*
   * The scheme, and where it is kept.
   *
   * localStorage like the language above it, and for a sharper reason: the
   * scheme has to be readable before the first paint or the page flashes the
   * OS's answer and then corrects itself. That rules out the database the
   * sentences live in, which is asynchronous. @lautstark/design/theme carries
   * the reasoning; the inline script in index.html is the half that runs before
   * this module exists, and main.ts's `initTheme` is what subscribes to the
   * machine changing its mind — conventions.md §6.10 names that call as the
   * half of adopting the picker no component mounted in a sheet can make, and
   * this product was already making it.
   *
   * The control itself is @lautstark/design/svelte/ThemePicker. What is left
   * here is the three things the four products differed on and which are its
   * three props: where the choice is kept, the three words in this page's
   * language, and — through `bind:theme` — the text the panel's summary shows.
   * The value is read here rather than left to the component's own fallback
   * because this record is what draws the summary, and it has to say something
   * true on the first frame rather than on the first frame after the picker
   * mounts.
   */
  const THEME_KEY = 'mitreden.theme';
  const themeLabel = (theme: Theme): string => t(`theme_${theme}` as Key);
  let theme = $state<Theme>(readTheme(THEME_KEY));

  // ------------------------------------------------------------ der Schlüssel

  /**
   * Azure, as a connection that is there or not.
   *
   * @lautstark/stimmquelle/svelte/AzureConnection since 2026-10-31, under the
   * voice list rather than in a panel of its own: „Stimmen von Microsoft
   * Azure", whether they are connected, and one button. The button unfolds
   * the key and the region together, with a cancel beside the save; once Azure
   * answers, its voices join the list above and there is nothing else to find.
   * bildhaft took the same two pieces the same day.
   *
   * What stays here is everything the package deliberately does not own:
   *
   * - **the probe**. This product has exactly one regex for Azure's refusal and
   *   it lives in core/voices.ts, where the picker's own catalogue call shares
   *   its memoisation — one settings-opening asks Azure once, not twice. §6.9
   *   injects it.
   * - **the words**, including `failed`, which takes Azure's own message, and
   *   the plural, which only this product can put into its own language.
   * - **the region as a place**. Somebody who has never opened the Azure portal
   *   knows „Frankfurt" and not `germanywestcentral`. Only the European ones
   *   are named; anything else reads as Azure's code. The default region is
   *   still the package's: this product has never chosen one of its own.
   * - **the two paragraphs over the fields**: `azure_body` is prose and
   *   `azure_warn` is a `.notice.bad.warn`, which is a rule of this product's
   *   and which §6.0 forbids the package emitting. They are the children, so
   *   they show while connecting for the first time — the moment somebody is
   *   deciding whether to.
   */
  type Azure = { key: string; region: string };
  let azure = $state<Azure | undefined>(undefined);
  let azureLoaded = $state(false);

  /** What the database says now. The box redraws itself off `hasKey` and
   *  `region`, so this is the whole of what a save or a forget has to do here. */
  async function readAzure(): Promise<void> {
    const saved = await settings();
    azure = saved.azure;
    azureLoaded = true;
  }

  /* Read through `t()` on each call, so a language changed two rows up
     reaches the box's next paint. */
  const REGIONS: Record<string, () => string> = {
    germanywestcentral: () => 'Frankfurt',
    westeurope: () => t('region_westeurope'),
    northeurope: () => t('region_northeurope'),
    switzerlandnorth: () => 'Zürich',
    francecentral: () => 'Paris',
    uksouth: () => 'London',
    swedencentral: () => t('region_sweden'),
    norwayeast: () => 'Oslo',
  };
  const regionName = (code: string): string => REGIONS[code]?.() ?? code;

  /**
   * Every sentence the box and its form can say, all of them this page's.
   *
   * `$derived`, so a language changed in the panel above reaches it: the
   * object is new and the box redraws. There is no `lang` prop here, because
   * the language arrives with the words.
   *
   * `refusedOnSave` is longer than `refused` on purpose: a key is bound to one
   * region and the wrong pairing answers the same 401 as a wrong key, so at
   * the moment somebody is making the pairing, saying which is more use than
   * repeating Azure.
   */
  const azureWords = $derived<AzureConnectionWords>({
    key: t('key_field'),
    region: t('region_field'),
    regionHint: t('region_hint'),
    save: t('key_save'),
    saving: t('key_checking'),
    forget: t('key_forget'),
    cancel: t('cancel'),
    asking: t('azure_asking'),
    typeFirst: t('type_first'),
    answers: (count) => tn('azure_answers', count),
    saved: (count) => t('key_saved', { label: 'Azure Speech', n: count }),
    unreachable: t('azure_unreachable'),
    refused: t('azure_refused'),
    refusedOnSave: t('key_failed', { error: t('azure_bad_pair') }),
    failed: (words) => t('azure_no_answer', { error: words }),
    title: t('azure_title'),
    off: t('azure_off'),
    on: t('azure_on'),
    refusedState: t('azure_refused_state'),
    offNote: t('azure_off_note'),
    onNote: (hint, region) => t('azure_on_note', { hint, region }),
    refusedNote: t('azure_refused_note'),
    connect: t('azure_connect'),
    change: t('azure_change'),
    check: t('azure_check'),
  });

  /* The probe, adapted at the seam and nowhere else. The panel's `AzureAccess`
     has `key` optional, because vorlaut-editor's key lives on a machine that
     page cannot read back; this product's always reads back, so the shape is
     narrowed here rather than widened in core/voices.ts, where a key that might
     be missing would be a lie about what `azureCatalogue` needs. */
  const askAzure = (access: AzureAccess) =>
    probeAzure({ key: access.key ?? '', region: access.region });

  async function keepKey(next: AzureAccess): Promise<void> {
    await saveAzure({ key: next.key ?? '', region: next.region });
    // The box and the picker are what this save feeds. The dialog stays
    // open, so both land on the screen the key was typed into; the probe is
    // memoised per key and region, so neither asks Azure again.
    await loadVoices();
    await readAzure();
  }

  async function forgetKey(): Promise<void> {
    await saveAzure(undefined);
    say(t('key_removed', { label: 'Azure Speech' }));
    await loadVoices();
    await readAzure();
  }

  // ------------------------------------------------------------ die Ablage

  /* The store panel and the standing copy both come from the package, so every
     Lautstark programme shows the same two. What stays here is what mitreden
     alone offers besides them, and it sits outside both rather than in the
     ablage panel's `below` snippet: the folder question is answered first and
     this product's own export is a separate offer under its own subheading.

     `lang` is a prop on each rather than the thunk the vanilla modules took.
     The rule it carries is unchanged and was mitreden's first — this page
     changes language without reloading, and a locale captured once answers in
     the language the reader has just left while staying perfectly well-formed
     — but the reading is now a `$derived` the components depend on, so nothing
     here has to remember to repaint them. §6.8. */

  // ------------------------------------------------------------ die Zustände

  /**
   * What each panel holds, said in its own heading.
   *
   * This is the whole reason the tabs went: a tab is a promise that something
   * is behind it, and you have to open it to find out what. A heading that
   * already says "Kristin · Mitgeliefert · Englisch", "Deutsch · Hell" or "42
   * Sätze" is usually the entire question, and opening becomes a decision
   * rather than the only way to look.
   */
  let voice = $derived(knownVoices().find((one) => one.id === chosenVoice()));
  let voiceState = $derived(voice
    ? `${voice.label} · ${sourceOf(voice.source)} · ${speaks(voice.lang)}`
    : t('voice_none'));
  /* The same endonym the pressed button carries, off the same table — the
     heading and the row must not be able to disagree about what „de" is
     called. */
  let lookState = $derived.by(() => `${NAMES[lang()] ?? lang()} · ${themeLabel(theme)}`);
  /* ALL(), not a fresh read: the sentences are already in memory, and a heading
     that carries state has to carry it from the first frame. Reading the
     database here left this line blank at the moment somebody was reading it —
     which is the one thing this shape promises not to do. */
  /* Told by „Deine Daten" itself — where the work is, the same words in every
     Lautstark programme. It answers synchronously on its first paint, so the
     heading is not blank when the sheet opens. */
  let dataState = $state('');
  /* How much of the library does not sound like itself: never recorded, or
     changed since it was. The button below reads it, and so does whether there
     is anything to press. */
  let waiting = $derived(ALL().filter((item) => item.state !== 'ok').length);

  void readAzure();
</script>

<!-- `panels`: a column of <details>, 900px. This dialog showed the same column
     at 600px while wochenwerk showed it at 900, and wochenwerk was the one with
     a reason written down. See design/docs/conventions.md 4.14. #info and
     #colvoice stay 600 — neither is a column of panels.

     `bind:open` here rather than the one-way form, because this one really is
     a boolean: App.svelte owns it and the frame writes it back on every way
     out, which is what the hand-written `onclose` used to do.

     `closeId` rather than `nameParts`: design v1.35.0 gives the ✕ an id of its
     own, which is the prop ui/dialog.ts named as the fix, and this is the call
     site taking it. Nothing writes to the frame after the fact any more. -->
<Sheet
  id="setup"
  panels
  bind:open
  title={t('settings')}
  closeLabel={t('close')}
  closeId="setupclose"
>
  <!-- First, and open on arrival. Somebody who cannot read this page needs this
       panel before any of the others, and the language row names itself —
       „Deutsch" and „English" are the same words whichever language the rest
       of the sheet is in. vorlaut put it here first and said why; the reasoning
       is not vorlaut's, it is the page's. The `open` attribute this used to
       carry is `folded` above now — see there for why arrival state cannot be
       markup in a sheet that is never unmounted.

       Language and scheme are one panel since 2026-10-31: both are what this
       page is rather than what is in it, both live in this browser only, and
       they are offered the same way — two segmented rows, one caption each,
       and one sentence under both. The captions are `.subhead`, this file's
       uppercase caption; `.opt` is only the row. -->
  <Panel id="p-look" stateId="lookstate" section={t('panel_look')}
    state={lookState} bind:open={folded.look}>
    <!-- A native select first — it drew its own chevron from a hex baked into
         a data URI, which cannot read a token — and then a button and a menu,
         which put the choice behind a press. A menu is for a list of things to
         do; this is a list of what the page is. -->
    <div class="opt">
      <p class="subhead">{t('panel_language')}</p>
      <Vanilla node={langs.node} />
    </div>
    <!-- conventions.md §6.10. `#theme` is a prop because e2e/theme.spec.ts
         names it. "Follows the device" is an answer too, and the default one —
         a two-state switch has to open in light or dark and so has to guess,
         which is how a tablet that dims itself at dusk ends up pinned bright. -->
    <div class="opt">
      <p class="subhead">{t('panel_theme')}</p>
      <ThemePicker
        id="theme"
        key={THEME_KEY}
        label={themeLabel}
        ariaLabel={t('panel_theme')}
        bind:theme
      />
    </div>
    <!-- The key stays on the element as well as in the text: it is what
         e2e/app.spec.ts names to ask that this sentence exists at all. -->
    <p class="hint" data-i18n="look_note">{t('look_note')}</p>
  </Panel>

  <!-- The default a new Sammlung starts with, and not the voice the next
       sentence gets. What one particular Sammlung records in is behind the ⋯
       beside its name; conventions.md §3.10 is the test that put it there, and
       the hint below is how somebody standing in front of this list finds it. -->
  <Panel id="p-voice" stateId="voicestate" section={t('panel_voice_default')}
    state={voiceState} bind:open={folded.voice}>
    <p class="hint">{t('voice_default_hint')}</p>
    <!-- The field, the language pills and the list are one block from
         @lautstark/stimmquelle/svelte/VoicePicker. `#voices` is this page's
         name for where the block goes; the suite reaches it through it.

         `folded` (stimmquelle 2.15.0): with a voice chosen, the box shows that
         voice and „Andere Stimme …", and the search and the rows come out only
         when somebody asks for them. A row chosen there folds them away again.
         With nothing chosen the list is open, because there is nothing to fold
         to.

         ## Two instances, and never one

         There are two — what a new Sammlung starts with, here, and what one
         particular Sammlung records in, in ui/CollectionVoice.svelte — and
         they are different questions about the same catalogue, so each gets
         its own tag. The query and the language filter are somebody's place in
         a list of hundreds, and the component holds that state per instance.
         The Sammlung's sheet stays unfolded: it is opened to choose, and
         nothing else is in it.

         `hear` is not passed: this page speaks a voice by recording with it,
         and there is nothing here that plays a sample.

         `voices` and `current` are read on every paint rather than passed
         once: an Azure key saved directly below adds several hundred rows. -->
    <div id="voices">
      <VoicePicker
        voices={knownVoices}
        current={chosenVoice}
        pick={(id) => void pickVoice(id)}
        folded
        {lang}
      />
    </div>

    <!-- Azure under the voices it adds. Gated on the first read of the
         database, so the box does not say „nicht verbunden" for one frame to
         somebody who is. The ids are the form's, and the suite's. -->
    {#if azureLoaded}
      <div class="azure-slot">
        <AzureConnection
          id="azure"
          formId="cloud"
          fieldId="azurekey"
          regionId="azureregion"
          saveId="azuresave"
          forgetId="azureforget"
          probeId="azureprobe"
          hasKey={azure !== undefined}
          hint={azure?.key.slice(-4) ?? ''}
          region={azure?.region}
          {regionName}
          stored={async () => (await settings()).azure?.key}
          probe={askAzure}
          save={keepKey}
          forget={forgetKey}
          words={azureWords}
          announce={say}
        >
          <p class="sub says">{t('azure_body')}</p>
          <p class="notice bad warn">{t('azure_warn')}</p>
        </AzureConnection>
      </div>
    {/if}

    <!-- The library, brought up to date with its own voices. Here because what
         it is about is speech, and because this is the panel somebody is
         already in when they wonder why a Sammlung is silent. The number is on
         the button: it is the whole reason to press it. -->
    <hr class="hair" />
    <p class="subhead">{t('record_all_title')}</p>
    <p class="hint">{t('record_all_hint')}</p>
    <button class="btn sm" id="recordall" disabled={!waiting}
      onclick={() => void recordEverything()}
    >{t('record_all')}{waiting ? ` · ${t('record_all_waiting', { n: waiting })}` : ''}</button>
  </Panel>

  <!-- „Deine Daten", @lautstark/sicherung/svelte/DatenPanel: the same panel in
       every Lautstark programme. One box says where the sentences are and
       whether that is safe, at most one button sits under it, and the ⋯ in its
       corner holds the rest — another folder, the file out and in, the dated
       second copy while the work is in the browser, and „Alles löschen", which
       was a panel of its own until 2026-10-31 and still asks first. The id
       stays p-data. -->
  <Panel id="p-data" stateId="datastate" section={t('panel_backup')}
    state={dataState} bind:open={folded.data}>
    <div id="wherebox">
      <DatenPanel
        store={ablage}
        adopt={adoptFolder}
        changed={() => void load()}
        {say}
        lang={reading}
        {backup}
        headline={(text) => { dataState = text; }}
        file={{ download: () => void exportAll(), read: (picked) => void importFile(picked), note: t('backup_file_note') }}
        wipe={() => void wipeEverything()}
      />
    </div>
  </Panel>
</Sheet>
