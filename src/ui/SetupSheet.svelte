<script lang="ts">
  /**
   * Einstellungen: what this page is, which voice a new Sammlung starts with,
   * where the work lives, and the one act that destroys something.
   *
   * ## Six panels, not three tabs
   *
   * A tab hides two thirds of the settings behind a choice you have to make
   * before you can look; a panel says what it holds in its own heading — which
   * voice, whether Azure has a key, how many sentences there are — so a look is
   * enough and opening is a decision. components.css's `.panel`, native
   * `<details>`, so the browser owns the folding and the keyboard.
   *
   * `name="settings"` makes the six one exclusive group — opening one closes
   * the rest — which is the platform's own accordion and behaves like a radio
   * group. Without it the sheet becomes a scroll through everything anybody has
   * ever opened, and the state in each heading, which is the whole reason they
   * are folded, stops being readable at a glance.
   * @lautstark/design conventions.md §3.5.
   *
   * ## Why the headings are drawn rather than fetched on opening
   *
   * They read what the page already has in memory, which is the property
   * e2e/app.spec.ts asks for by clicking the gear and reading the four headings
   * in the same tick. `openSetup()` used to write „Wird geladen …" into the
   * Azure one by hand, because that answer comes from the database and the
   * panel was drawn at the moment of the press. The sheet is in the page from
   * the start now, so the read has already happened — and `azureLoaded` is
   * still here, because the *first* frame of the *first* visit has not, and a
   * state is what this summary is for while empty is not.
   *
   * ## The frame, and the one rule that had to come with it
   *
   * @lautstark/design/svelte/Sheet since 2026-09-17, and the six panels are
   * @lautstark/design/svelte/Panel. What kept this dialog hand-written was
   * that it had no `.body` region at all — the panels were the dialog's own
   * children — and the shared frame always draws one. `.sheet > .body` sets
   * `color: var(--text-dim)` and `font-size: 14px`, and both are **inherited**
   * rather than selected, so a child combinator cannot protect what is under
   * them: every panel heading in this column would lose its colour, and
   * `.where-panel p`, `.where` and `.backup-panel > p` — markup two *other*
   * packages draw — would shift with it.
   *
   * conventions.md §6.1 leaves that at a fork and names the reason: „Wo alles
   * liegt" is the one shot in this product that photographs another
   * repository's panels, and e2e/visual.spec.ts says that is exactly what it
   * exists to watch. Re-recording it inside a design-frame change spends the
   * evidence it was taken for. So this took the first branch of the fork — the
   * panels keep their colour by a rule that says so — and that rule is
   * `#setup > .body` in src/styles/app.css, which hands the inherited pair
   * straight back. wo-alles-liegt.png, standardstimme.png and
   * alles-loeschen.png are unchanged by this commit, and that is by
   * construction rather than by luck: nothing inside the body region inherits
   * anything it did not inherit before.
   *
   * ## The panels inside the panels
   *
   * Four of these six hold a block another repository draws, and since
   * 2026-09-17 every one of them is a component rather than a node in a
   * `Vanilla`: @lautstark/sicherung's `AblagePanel` and `BackupPanel`,
   * @lautstark/stimmquelle's `VoicePicker` and `AzurePanel`. What that bought
   * is conventions.md §6.8 — the repaint, the subscription and its teardown are
   * the framework's, `lang` is a prop rather than a thunk read per paint, and a
   * job still in flight when the sheet closes no longer writes into a tree
   * nobody can see. Four `refresh()` calls, two `dispose()`s and an `onDestroy`
   * went with them.
   *
   * The one still hosted in a `Vanilla` is the language row, and that is not an
   * oversight: @lautstark/design ships no Svelte twin of `languagePicker`. Its
   * `langs.node.id = 'lang'` below is the last imperative seam in this file.
   */
  import { untrack } from 'svelte';
  import Panel from '@lautstark/design/svelte/Panel';
  import Sheet from '@lautstark/design/svelte/Sheet';
  import { applyTheme, readTheme, saveTheme, THEMES, type Theme } from '@lautstark/design/theme';
  import { languagePicker, NAMES } from '@lautstark/design/language';
  import Vanilla from '@lautstark/design/svelte/Vanilla';
  import AblagePanel from '@lautstark/sicherung/svelte/AblagePanel';
  import BackupPanel from '@lautstark/sicherung/svelte/BackupPanel';
  import type { Sicherung } from '@lautstark/sicherung';
  import AzurePanel from '@lautstark/stimmquelle/svelte/AzurePanel';
  import type { AzureAccess, AzureWords } from '@lautstark/stimmquelle/svelte/AzurePanel';
  import VoicePicker from '@lautstark/stimmquelle/svelte/VoicePicker';
  import { ablage, isStore } from '../db/folder.ts';
  import { adoptFolder } from '../db/mirror.ts';
  import { saveAzure, settings } from '../db/repo.ts';
  import { probeAzure } from '../core/voices.ts';
  import { LANGS, type Lang } from '../i18n/index.ts';
  import { ALL, load } from './store.svelte.ts';
  import { chosenVoice, knownVoices, loadVoices, pickVoice, relangVoice } from './voices.svelte.ts';
  import { exportAll, importFile, wipeEverything } from './settings.ts';
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
  const PANELS = ['lang', 'voice', 'azure', 'theme', 'data', 'danger'];
  /** §3.11: Sprache first, and the only one open. */
  const OPENS_WITH = 'lang';
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
   * this module exists.
   */
  const THEME_KEY = 'mitreden.theme';
  const themeLabel = (theme: Theme): string => t(`theme_${theme}` as Key);
  let theme = $state<Theme>(readTheme(THEME_KEY));

  // ------------------------------------------------------------ der Schlüssel

  /**
   * The key, and whether Azure answers for it.
   *
   * The panel is @lautstark/stimmquelle/svelte/AzurePanel since 2026-09-17 —
   * conventions.md §6.9, three consumers and one of them is this one. What
   * went is 90 lines of field, region, placeholder, probe and save that
   * wochenwerk and vorlaut-editor had each written too, and the region list
   * that all three carried character for character. What stayed here is
   * everything the panel deliberately does not own:
   *
   * - **the probe**. This product has exactly one regex for Azure's refusal and
   *   it lives in core/voices.ts, where the picker's own catalogue call shares
   *   its memoisation — one settings-opening asks Azure once, not twice. A
   *   panel that brought a second probe would be duplicating a function this
   *   product already has, so §6.9 injects it.
   * - **the words**, including `failed`, which takes Azure's own message. A
   *   codes-only seam would have deleted it from the sentence.
   * - **the plural**, because a count is a number the panel has and only this
   *   product can put into its own language's plural.
   * - **the two paragraphs above the fields**: `azure_body` is prose and
   *   `azure_warn` is a `.notice.bad.warn`, which is a rule of this product's
   *   and which §6.0 forbids the package emitting. They arrive as snippets.
   *
   * `azure` and `azureLoaded` stay because the *heading* is this file's: which
   * key, not merely that there is one.
   */
  type Azure = { key: string; region: string };
  let azure = $state<Azure | undefined>(undefined);
  let azureLoaded = $state(false);

  /** What the database says now. The panel redraws itself off `hasKey` and
   *  `region`, so this is the whole of what a save or a forget has to do here. */
  async function readAzure(): Promise<void> {
    const saved = await settings();
    azure = saved.azure;
    azureLoaded = true;
  }

  /**
   * Every sentence the panel can say, all of them this page's.
   *
   * `$derived`, so a language changed in the panel two rows above this one
   * reaches it: the object is new and the panel redraws. That is §6.8's „`lang`
   * is a prop and reactivity is the framework's" in the form the Azure panel
   * takes it — there is no `lang` prop here, because the language arrives with
   * the words.
   *
   * `refusedOnSave` is longer than `refused` on purpose and the panel asks for
   * exactly that distinction: a key is bound to one region and the wrong
   * pairing answers the same 401 as a wrong key, so at the moment somebody is
   * making the pairing, saying which is more use than repeating Azure. On the
   * probe line, where nothing is being made, the short sentence is right.
   *
   * `failed` has one form where this page had two, and that is the one wording
   * change in the adoption. The probe line used to say „Die Abfrage ist
   * fehlgeschlagen — später noch einmal versuchen" while a save said „Azure hat
   * nicht geantwortet (…)", with Azure's own message in the brackets. The panel
   * renders what the probe returns, so both are the second sentence now and
   * `azure_failed` is gone from both tables. It is the better of the two: it
   * was the same condition described twice, once without the only piece of
   * evidence there is.
   */
  const azureWords = $derived<AzureWords>({
    key: t('key_field'),
    region: t('region_field'),
    regionHint: t('region_hint'),
    save: t('key_save'),
    saving: t('key_checking'),
    forget: t('key_forget'),
    asking: t('azure_asking'),
    typeFirst: t('type_first'),
    answers: (count) => tn('azure_answers', count),
    saved: (count) => t('key_saved', { label: 'Azure Speech', n: count }),
    unreachable: t('azure_unreachable'),
    refused: t('azure_refused'),
    refusedOnSave: t('key_failed', { error: t('azure_bad_pair') }),
    failed: (words) => t('azure_no_answer', { error: words }),
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
    // The heading and the picker are what this save feeds. The dialog stays
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

  /**
   * Whether the standing copy is offered at all, read once and correctly so.
   *
   * Two conditions, and they were two before: no store folder — with one, the
   * copies already go beside the work and a second picker would be the same
   * offer under a name that reads almost the same — and a browser with a
   * picker at all. `backupPanel()` answered `null` for the second; a component
   * cannot answer null, so it draws nothing and the box around it would be an
   * empty 32px of margin. Hence the flag, and hence it guards both.
   *
   * Neither can move while the page is up: there is one `Sicherung` for the
   * life of the page, made in main.ts and handed down, and an unsupported
   * browser has no other status to be in.
   */
  // svelte-ignore state_referenced_locally
  const keeps = !isStore() && backup.status.kind !== 'unsupported';

  let file: HTMLInputElement;

  // ------------------------------------------------------------ die Zustände

  /**
   * What each panel holds, said in its own heading.
   *
   * This is the whole reason the tabs went: a tab is a promise that something
   * is behind it, and you have to open it to find out what. A heading that
   * already says "Kristin · Mitgeliefert · Englisch", "Kein Schlüssel" or "42
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
  let langState = $derived.by(() => { void lang(); return NAMES[lang()] ?? lang(); });
  /* ALL(), not a fresh read: the sentences are already in memory, and a heading
     that carries state has to carry it from the first frame. Reading the
     database here left this line blank at the moment somebody was reading it —
     which is the one thing this shape promises not to do. */
  let dataState = $derived(ALL().length ? tn('count', ALL().length) : t('count_none'));

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
       panel before any of the others, and the two options below name themselves
       — „Deutsch" and „English" are the same words whichever language the rest
       of the sheet is in. vorlaut put it here first and said why; the reasoning
       is not vorlaut's, it is the page's.

       It is also why nothing else opens on arrival: one panel open is a choice
       about which one somebody most needs, and this is the only one where not
       reading the page is the case being answered. The `open` attribute this
       used to carry is `folded` above now — see there for why arrival state
       cannot be markup in a sheet that is never unmounted. -->
  <Panel id="p-lang" stateId="langstate" section={t('panel_language')}
    state={langState} bind:open={folded.lang}>
    <!-- The same segmented control as the scheme below it, and that pairing
         is the point: two facts about this page, offered the same way. It was
         a native select first — it drew its own chevron from a hex baked into
         a data URI, which cannot read a token, so it was the one control that
         could not follow the theme — and then a button and a menu, which put
         the choice behind a press. A menu is for a list of things to do; this
         is a list of what the page is. -->
    <Vanilla node={langs.node} />
    <!-- The key stays on the element as well as in the text. It is what
         e2e/app.spec.ts names to ask that this sentence exists at all — the
         one assertion in that file the compiler could not make — and the two
         cannot drift, because the attribute and the lookup are the same
         string on the same line. -->
    <p class="hint" data-i18n="language_hint">{t('language_hint')}</p>
  </Panel>

  <!-- The default a new Sammlung starts with, and not the voice the next
       sentence gets — which is what this panel used to say and what it stopped
       being when the voice moved onto the Sammlung. What one particular
       Sammlung records in is behind the ⋯ beside its name; conventions.md §3.10
       is the test that put it there, and the hint below is how somebody
       standing in front of this list finds it. -->
  <Panel id="p-voice" stateId="voicestate" section={t('panel_voice_default')}
    state={voiceState} bind:open={folded.voice}>
    <p class="hint">{t('voice_default_hint')}</p>
    <!-- The field, the language pills and the list are one block from
         @lautstark/stimmquelle/svelte/VoicePicker, which brings its own markup
         and its own words in both languages. `#voices` is this page's name for
         where the block goes; the suite reaches the field and the rows
         through it.

         ## Two instances, and never one

         There are two — what a new Sammlung starts with, here, and what one
         particular Sammlung records in, in ui/CollectionVoice.svelte — and
         they are different questions about the same catalogue, so each gets
         its own tag rather than a shared one that drifts.

         A shared instance would have been cheaper and wrong: the query and the
         language filter are somebody's place in a list of hundreds, and
         carrying a search for „kerstin" out of one dialog into the other would
         look like the second one had lost most of its voices. The component
         holds that state per instance, and two tags being two pickers is what
         keeps the rule without anything having to remember it.

         `hear` is not passed: this page speaks a voice by recording with it,
         which is minutes of synthesis and a file, and there is nothing here
         that plays a sample. So no `▶` is drawn — the component draws the row
         wrapper either way, so the day this page grows a sample player nothing
         else moves.

         `voices` and `current` are read on every paint rather than passed
         once: an Azure key saved in the panel directly below this one adds
         several hundred rows, and the Sammlung's sheet draws for a different
         Sammlung each time it opens. -->
    <div id="voices">
      <VoicePicker
        voices={knownVoices}
        current={chosenVoice}
        pick={(id) => void pickVoice(id)}
        {lang}
      />
    </div>
  </Panel>

  <!-- Which key, not merely that there is one: the last four characters tell
       two keys apart without giving either away. It sits in the panel's
       heading, so the answer is there before the panel is opened. -->
  <Panel id="p-azure" stateId="azurestate" section="Azure Speech"
    state={!azureLoaded ? t('loading')
      : azure ? t('key_hint', { hint: azure.key.slice(-4) }) : t('key_none')}
    bind:open={folded.azure}>
    <!-- No head and no card: the panel's summary names this and says whether
         Azure holds a key, which is the whole point of a heading that carries
         its state.

         ## The ids, and what happened to the class names

         The bare class names that used to be in here — `.probe`, `.says`,
         `.save`, `.forget`, `.region` — were hooks for the suite rather than
         components, under one invariant: none of them could be a name
         components.css owns. That invariant inverts the moment the package
         starts emitting the markup, so §6.9 turns them into ids and they come
         back as props. `#cloud` is the panel's own box now rather than a div
         around it; every e2e use of `#cloud` was a descendant selector and
         still lands, and `#azuresave`, `#azureforget` and `#azureprobe` are
         what replace the three class hooks. `#azurekey` and `#azureregion`
         were already ids and are unchanged.

         The two paragraphs that stayed here stayed for §6.0's reason: a
         provider package may not emit a product's rule. `azure_warn` is
         `.notice.bad.warn` and `warn` is this file's, so it arrives as the
         `warning` snippet; `azure_body` is prose nobody else says and arrives
         as the children. `.sub` was `sub body` once, which the shared
         `.sheet .body` region rule reached and quietly took from 15px to
         14px — v1.4.1 made those rules child combinators and handed it back,
         and the rename is so it cannot be caught again.

         The probe line is a live region and it is never hidden — §3.8. It used
         to be toggled with `[hidden]`, which is one of the two ways that
         section names for getting silence: the element leaves the
         accessibility tree and comes back carrying its next message. The panel
         empties the text instead and guards the margin with `:empty`, which is
         the same arrangement under a new name. -->
    <AzurePanel
      id="cloud"
      fieldId="azurekey"
      regionId="azureregion"
      hintId="azurehint"
      saveId="azuresave"
      forgetId="azureforget"
      probeId="azureprobe"
      hasKey={azure !== undefined}
      placeholder={azure ? `••••${azure.key.slice(-4)}` : ''}
      region={azure?.region}
      stored={async () => (await settings()).azure?.key}
      probe={askAzure}
      save={keepKey}
      forget={forgetKey}
      words={azureWords}
      announce={say}
    >
      <p class="sub says">{t('azure_body')}</p>
      {#snippet warning()}<p class="notice bad warn">{t('azure_warn')}</p>{/snippet}
    </AzurePanel>
  </Panel>

  <!-- Beside the language, because both are what this page is rather than what
       is in it. The three answers are one control: "follows the OS" is an
       answer too, and the default one — a two-state switch has to open in light
       or dark and so has to guess, which is how a tablet that dims itself at
       dusk ends up pinned bright. -->
  <Panel id="p-theme" stateId="themestate" section={t('panel_theme')}
    state={themeLabel(theme)} bind:open={folded.theme}>
    <!-- role=group, not radiogroup: components.css marks the choice with
         aria-pressed, which is what bildhaft's print dialog already uses, and
         a radiogroup whose children are not radios reads worse than a
         labelled group of buttons. -->
    <div class="segmented" id="theme" role="group" aria-label={t('panel_theme')}>{#each THEMES as option}<button
      type="button" aria-pressed={option === theme} onclick={() => {
        saveTheme(THEME_KEY, option);
        applyTheme(option);
        // Nothing else on the page depends on the scheme — the tokens do that
        // work, which is the point of there being tokens.
        theme = option;
      }}>{themeLabel(option)}</button>{/each}</div>
    <p class="hint">{t('theme_hint')}</p>
  </Panel>

  <!-- Getting your work out and back, and nothing else. The id stays p-data;
       the heading is „Wo alles liegt" because that is the one subject left in
       here since the reset moved out below. -->
  <Panel id="p-data" stateId="datastate" section={t('panel_backup')}
    state={dataState} bind:open={folded.data}>
    <!-- The store: one panel for every Lautstark programme, drawn by
         @lautstark/sicherung/svelte/AblagePanel so the words and the order are
         the same wherever somebody meets them. Everything below it is what
         mitreden offers besides the store.

         `#wherebox` stays a box of this file's rather than becoming the
         panel's `id`, and it is worth saying why in the one panel that has a
         picture: wo-alles-liegt.png is the only baseline in this product that
         photographs another repository's markup, and it exists to say whether
         a Svelte twin has drifted from the vanilla original. Taking a div out
         of the shot in the same commit would be a second reason for it to move
         and would spend exactly the evidence it was taken for. -->
    <div id="wherebox">
      <AblagePanel
        store={ablage}
        adopt={adoptFolder}
        changed={() => void load()}
        {say}
        lang={reading}
      />
    </div>
    <hr class="hair" />
    <p class="subhead">{t('panel_keep')}</p>
    <!-- No „Sicherung." in front of it any more: the panel is called that
         now, and a lead repeating its own heading is a word somebody reads
         twice to learn nothing. -->
    <p class="notice">{t('backup_intro')}</p>

    <!-- The folder first, because it is the one that keeps working after
         somebody stops thinking about it. Hidden outright where there is
         nothing to offer. -->
    <div id="folderbox" class="folderbox" hidden={!keeps}>{#if keeps}<BackupPanel
      {backup} {say} lang={reading} />{/if}</div>

    <!-- The two halves of the same subject, side by side. „Sicherung
         einlesen" used to be „Importieren" in the rail, a screen away from
         the button that makes the file it reads — history rather than intent,
         since that button predates there being a backup format and quietly
         gained a second job when one arrived. It still does both: importFile
         routes on the file's own shape. -->
    <div class="row">
      <!-- Not primary. The panel above is @lautstark/sicherung's and its
           „Ordner wählen" already carries the accent fill, which design.md
           §4.3 gives to one thing per screen. Two filled buttons a few pixels
           apart in one colour read as a single control — a visual baseline
           showed it the moment one was taken. -->
      <button class="btn sm" id="export" onclick={() => void exportAll()}>{t('backup_export')}</button>
      <button class="btn sm" id="import2" onclick={() => file.click()}>{t('backup_import')}</button>
    </div>
    <p class="hint">{t('backup_hint')}</p>
    <input type="file" id="importfile" accept="application/json,.json" hidden bind:this={file}
      onchange={(event) => {
        const input = event.currentTarget;
        const picked = input.files?.[0];
        input.value = '';
        if (picked) void importFile(picked);
      }}>
  </Panel>

  <!-- Its own panel. It was an <h3> inside „Daten", which is a second heading
       level doing a panel's job: a destructive reset is not a data-management
       chore filed under the same word as making a backup, and a column whose
       last entry says „Alles löschen" is more honest than one where you have to
       open „Daten" to find it. vorlaut never put the wipe in its Daten panel;
       this is the other two catching up. §3.12.

       `state` is left undefined rather than passed as `''`, and the difference
       is measurable: Panel draws the `.state` span only when there is a state,
       and below 560px the summary is a two-column grid where an empty span is
       a second row and 2px of summary. This panel is the one whose state is
       unknowable — "everything" is not a quantity worth restating — so it has
       never carried a span and still does not. -->
  <Panel id="p-danger" section={t('danger_title')} state={undefined}
    bind:open={folded.danger}>
    <p class="hint danger__body">{t('danger_body')}</p>
    <button class="btn destructive sm" id="wipe" onclick={() => void wipeEverything()}>{t('danger_do')}</button>
  </Panel>
</Sheet>
