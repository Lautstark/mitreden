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
   * ## The frame
   *
   * Hand-written `<dialog class="sheet panels">` rather than
   * @lautstark/design/dialog's frame, for InfoSheet.svelte's reason and one
   * more: this sheet has no `.body` region at all — the panels are the dialog's
   * own children, which is what `.sheet.panels` in components.css lays out —
   * and the package's frame wraps its contents in one. einstellungen.png is
   * compared at a tolerance of zero.
   */
  import { onDestroy } from 'svelte';
  import { applyTheme, readTheme, saveTheme, THEMES, type Theme } from '@lautstark/design/theme';
  import { languagePicker, NAMES } from '@lautstark/design/language';
  import Vanilla from '@lautstark/design/svelte/Vanilla';
  import { wherePanel } from '@lautstark/sicherung/ablage-panel';
  import { backupPanel, type BackupPanel } from '@lautstark/sicherung/backup-panel';
  import type { Sicherung } from '@lautstark/sicherung';
  import { ablage, isStore } from '../db/folder.ts';
  import { adoptFolder } from '../db/mirror.ts';
  import { saveAzure, settings } from '../db/repo.ts';
  import { probeAzure } from '../core/voices.ts';
  import { LANGS, type Lang } from '../i18n/index.ts';
  import { ALL, load } from './store.svelte.ts';
  import { chosenVoice, knownVoices, loadVoices, pickVoice, relangVoice } from './voices.svelte.ts';
  import { exportAll, importFile, wipeEverything } from './settings.ts';
  import { lang, setLang, sourceOf, speaks, t, tn, type Key } from './words.svelte.ts';
  import { busy, say } from './dom.ts';
  import VoicePicker from './pieces/VoicePicker.svelte';

  let { open = $bindable(), backup }: { open: boolean; backup: Sicherung } = $props();

  let sheet: HTMLDialogElement;

  $effect(() => {
    if (open && !sheet.open) sheet.showModal();
    if (!open && sheet.open) sheet.close();
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
   * labels, the headings, the Azure card, the backup panel and a reload. Five
   * of the six are gone — every one of them read `t()` while it drew, and that
   * is now a dependency. What is left is the two that are not components: the
   * package panel that paints its own words, and the voice that is a guess
   * about which language to read aloud in.
   */
  function choose(code: Lang): void {
    setLang(code);
    localStorage.setItem('mitreden.lang', code);
    langs.refresh();
    /* The backup panel paints its own words and reads `lang()` on every paint,
       so one repaint is the whole of what it needs. */
    keeping?.refresh();
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
   * Azure's own region names. A datalist suggests rather than restricts, so a
   * region newer than this file still works by typing it — and the region is
   * what a rejected key usually turns out to be.
   */
  const AZURE_REGIONS = [
    'westeurope', 'northeurope', 'germanywestcentral', 'switzerlandnorth',
    'francecentral', 'uksouth', 'swedencentral', 'norwayeast', 'eastus', 'eastus2',
    'westus', 'westus2', 'westus3', 'centralus', 'southcentralus', 'canadacentral',
    'brazilsouth', 'australiaeast', 'southeastasia', 'eastasia', 'japaneast',
    'japanwest', 'koreacentral', 'centralindia', 'southafricanorth', 'uaenorth',
  ];

  type Azure = { key: string; region: string };
  let azure = $state<Azure | undefined>(undefined);
  let azureLoaded = $state(false);
  let probe = $state('');
  /* The held key sits in the placeholder, never in the value: a value can be
     revealed or resubmitted, a placeholder cannot. It is also what makes the
     save rule visible — this field left untouched keeps the key it shows. */
  let key = $state('');
  let region = $state('westeurope');
  let checking = $state(false);

  /**
   * The key, and whether Azure answers for it.
   *
   * Drawn on arrival and after a save or a forget, and deliberately not on
   * every act: this panel holds a field somebody is typing into. `known` is the
   * answer a save has just had; Azure would say the same thing twice.
   */
  async function readAzure(known?: Awaited<ReturnType<typeof probeAzure>>): Promise<void> {
    const saved = await settings();
    azure = saved.azure;
    azureLoaded = true;
    key = '';
    region = saved.azure?.region ?? 'westeurope';
    if (!saved.azure) { probe = ''; return; }
    if (known) { probe = wording(known); return; }
    // The person who stored a key has one question — does Azure answer? — and
    // the badge's "stored" was never it. Memoised per key and region, so this
    // line and the picker's own ask share a single request.
    probe = t('azure_asking');
    probe = wording(await probeAzure(saved.azure));
  }

  const wording = (answer: Awaited<ReturnType<typeof probeAzure>>): string => answer.ok
    ? tn('azure_answers', answer.count)
    : t(answer.code === 'unreachable' ? 'azure_unreachable'
      : answer.code === 'refused' ? 'azure_refused' : 'azure_failed');

  /**
   * Checked before it is stored, so a typo is a sentence now rather than a
   * failed recording later. The button says what it is doing meanwhile: the
   * check is a network round trip, and a button that does nothing visible for
   * two seconds is a button you press again.
   */
  async function saveKey(): Promise<void> {
    // The field is empty every time this panel draws, so an untouched field
    // must not mean "no key": a save that only moves the region keeps the key
    // it already has. Removing the key is its own button, not a way to save.
    const typed = key.trim() || (await settings()).azure?.key;
    if (!typed) {
      say(t('type_first'));
      return;
    }
    const where = region.trim() || 'westeurope';
    checking = true;
    busy('key_checking');
    try {
      const answer = await probeAzure({ key: typed, region: where });
      if (!answer.ok) {
        // A key is bound to one region, and the wrong pairing answers exactly
        // the same 401 as a wrong key — saying which is more use than repeating
        // Azure. A region name that is not one never answers at all, and that
        // difference is worth its own sentence too.
        say(t('key_failed', { error:
          answer.code === 'refused' ? t('azure_bad_pair')
            : answer.code === 'unreachable' ? t('azure_unreachable')
              : t('azure_no_answer', { error: answer.words }) }));
        return;
      }
      await saveAzure({ key: typed, region: where });
      say(t('key_saved', { label: 'Azure Speech', n: answer.count }));
      // The card and the picker are what this save feeds. The dialog stays
      // open, so the state line and the new voices land on the screen the key
      // was typed into; the probe is already answered, so neither asks again.
      await loadVoices();
      await readAzure(answer);
    } catch (error) {
      say(t('key_failed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      checking = false;
    }
  }

  async function forgetKey(): Promise<void> {
    await saveAzure(undefined);
    say(t('key_removed', { label: 'Azure Speech' }));
    await loadVoices();
    await readAzure();
  }

  // ------------------------------------------------------------ die Ablage

  /* The store panel comes from the package, so every Lautstark programme shows
     the same one. What stays here is what mitreden alone offers besides it. */
  const store = wherePanel({
    store: ablage,
    adopt: adoptFolder,
    changed: () => void load(),
    say,
    lang: lang() === 'en' ? 'en' : 'de',
  });

  /* The standing copy, and only where there is no store folder: with one, the
     copies already go beside the work, and a second picker would be the same
     offer under a name that reads almost the same. Null where the browser has
     no picker either — Safari, Firefox, anything on Android — so the download
     below is then the whole offer, unchanged.

     The 161 lines this replaces are @lautstark/sicherung/backup-panel's —
     words, markup, the age rule. What mitreden kept is `lang`, and it is a
     function rather than a value on purpose: this page changes language without
     reloading, and a locale captured once answers in the language the reader
     has just left while staying perfectly well-formed. That was mitreden's own
     rule and it is the module's now. */
  // svelte-ignore state_referenced_locally
  /* Read once on purpose: there is one Sicherung for the life of the page, made
     in main.ts and handed down. */
  const keeping: BackupPanel | null = isStore()
    ? null
    : backupPanel({ backup, say, lang: () => (lang() === 'en' ? 'en' : 'de') });

  onDestroy(() => keeping?.dispose());

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
     #colvoice stay 600 — neither is a column of panels. -->
<dialog id="setup" class="sheet panels" bind:this={sheet} onclose={() => { open = false; }}>
  <div class="head">
    <h2>{t('settings')}</h2>
    <button id="setupclose" class="btn quiet icon" aria-label={t('close')}
      onclick={() => { open = false; }}>✕</button>
  </div>

  <!-- First, and open on arrival. Somebody who cannot read this page needs this
       panel before any of the others, and the two options below name themselves
       — „Deutsch" and „English" are the same words whichever language the rest
       of the sheet is in. vorlaut put it here first and said why; the reasoning
       is not vorlaut's, it is the page's.

       It is also why nothing else opens on arrival: one panel open is a choice
       about which one somebody most needs, and this is the only one where not
       reading the page is the case being answered. -->
  <details class="panel" name="settings" id="p-lang" open>
    <summary>
      <span class="section">{t('panel_language')}</span>
      <span class="state" id="langstate">{langState}</span>
    </summary>
    <div class="body">
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
    </div>
  </details>

  <!-- The default a new Sammlung starts with, and not the voice the next
       sentence gets — which is what this panel used to say and what it stopped
       being when the voice moved onto the Sammlung. What one particular
       Sammlung records in is behind the ⋯ beside its name; conventions.md §3.10
       is the test that put it there, and the hint below is how somebody
       standing in front of this list finds it. -->
  <details class="panel" name="settings" id="p-voice">
    <summary>
      <span class="section">{t('panel_voice_default')}</span>
      <span class="state" id="voicestate">{voiceState}</span>
    </summary>
    <div class="body">
      <p class="hint">{t('voice_default_hint')}</p>
      <!-- The field, the language pills and the list are one block from
           @lautstark/stimmquelle/voice-picker, which brings its own markup and
           its own words in both languages. `#voices` is this page's name for
           where the block goes; the suite reaches the field and the rows
           through it. -->
      <div id="voices">
        <VoicePicker current={chosenVoice} pick={(id) => void pickVoice(id)} />
      </div>
    </div>
  </details>

  <details class="panel" name="settings" id="p-azure">
    <summary>
      <span class="section">Azure Speech</span>
      <!-- Which key, not merely that there is one: the last four characters
           tell two keys apart without giving either away. It sits in the
           panel's heading, so the answer is there before the panel is
           opened. -->
      <span class="state" id="azurestate">{!azureLoaded ? t('loading')
        : azure ? t('key_hint', { hint: azure.key.slice(-4) }) : t('key_none')}</span>
    </summary>
    <div class="body" id="cloud">
      <!-- The bare class names here are hooks for the suite, not components —
           which is why none of them may be a name components.css owns. This
           paragraph was `sub body` and sat inside the settings sheet, so the
           shared `.sheet .body` region rule reached it and quietly took it from
           15px to 14px. v1.4.1 made those rules child combinators and handed it
           back; the rename is so it cannot be caught again by whatever the
           vocabulary adds.

           No head and no card: the panel's summary names this and says whether
           Azure holds a key, which is the whole point of a heading that carries
           its state. -->
      <div>
        <!-- The probe line is a live region, and it is never hidden — §3.8. It
             used to be toggled with `[hidden]` when no key was stored, which is
             one of the two ways that section names for getting silence: the
             element leaves the accessibility tree and comes back carrying its
             next message. What is emptied now is the text, and empty it takes
             no room — which is what lets it stay. The `{#if}` is what keeps
             that true: a bound expression that is currently the empty string is
             still a child, and `.probe:empty` is what removes the margin. -->
        <p class="hint probe" role="status">{#if probe}{probe}{/if}</p>
        <p class="sub says">{t('azure_body')}</p><p class="notice bad warn">{t('azure_warn')}</p>
        <label for="azurekey">{t('key_field')}</label>
        <input id="azurekey" class="field" type="password" autocomplete="off"
          placeholder={azure ? `••••${azure.key.slice(-4)}` : ''} bind:value={key}>
        <label class="region" for="azureregion">{t('region_field')}</label>
        <input id="azureregion" class="field region" type="text" list="azureregions"
          spellcheck="false" bind:value={region}>
        <datalist id="azureregions">{#each AZURE_REGIONS as name}<option value={name}></option>{/each}</datalist>
        <p class="hint region">{t('region_hint')}</p>
        <div class="row"><button class="btn primary save" disabled={checking}
          onclick={() => void saveKey()}>{checking ? t('key_checking') : t('key_save')}</button><button
          class="btn quiet forget" hidden={!azure}
          onclick={() => void forgetKey()}>{t('key_forget')}</button></div>
      </div>
    </div>
  </details>

  <!-- Beside the language, because both are what this page is rather than what
       is in it. The three answers are one control: "follows the OS" is an
       answer too, and the default one — a two-state switch has to open in light
       or dark and so has to guess, which is how a tablet that dims itself at
       dusk ends up pinned bright. -->
  <details class="panel" name="settings" id="p-theme">
    <summary>
      <span class="section">{t('panel_theme')}</span>
      <span class="state" id="themestate">{themeLabel(theme)}</span>
    </summary>
    <div class="body">
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
    </div>
  </details>

  <!-- Getting your work out and back, and nothing else. The id stays p-data;
       the heading is „Wo alles liegt" because that is the one subject left in
       here since the reset moved out below. -->
  <details class="panel" name="settings" id="p-data">
    <summary>
      <span class="section">{t('panel_backup')}</span>
      <span class="state" id="datastate">{dataState}</span>
    </summary>
    <div class="body">
      <!-- The store: one panel for every Lautstark programme, built by
           @lautstark/sicherung/ablage-panel so the words and the order are the
           same wherever somebody meets them. Everything below it is what
           mitreden offers besides the store. -->
      <div id="wherebox"><Vanilla node={store.node} /></div>
      <hr class="hair" />
      <p class="subhead">{t('panel_keep')}</p>
      <!-- No „Sicherung." in front of it any more: the panel is called that
           now, and a lead repeating its own heading is a word somebody reads
           twice to learn nothing. -->
      <p class="notice">{t('backup_intro')}</p>

      <!-- The folder first, because it is the one that keeps working after
           somebody stops thinking about it. Hidden outright where there is
           nothing to offer. -->
      <div id="folderbox" class="folderbox" hidden={!keeping}>{#if keeping}<Vanilla node={keeping.node} />{/if}</div>

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
    </div>
  </details>

  <!-- Its own panel. It was an <h3> inside „Daten", which is a second heading
       level doing a panel's job: a destructive reset is not a data-management
       chore filed under the same word as making a backup, and a column whose
       last entry says „Alles löschen" is more honest than one where you have to
       open „Daten" to find it. vorlaut never put the wipe in its Daten panel;
       this is the other two catching up. -->
  <details class="panel" name="settings" id="p-danger">
    <summary>
      <span class="section">{t('danger_title')}</span>
    </summary>
    <div class="body">
      <p class="hint danger__body">{t('danger_body')}</p>
      <button class="btn destructive sm" id="wipe" onclick={() => void wipeEverything()}>{t('danger_do')}</button>
    </div>
  </details>
</dialog>
