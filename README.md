# mitreden

> ein Text, eine Stimme, eine Audiodatei

mitreden macht aus getipptem Text Audiodateien — alle in derselben Stimme.
Gedacht ist es für unterstützte Kommunikation: Wer über mehrere Geräte oder
Apps spricht, bekommt sonst von jedem davon eine andere Stimme geliehen. Hier
legst du die Stimme einmal fest, und alles klingt gleich.

`phrases.json` ist die Quelle der Wahrheit, `out/` das Ergebnis. Stimme
gewechselt? Ein Befehl, und alles klingt wieder einheitlich.

```
python3 mitreden.py ui        # Weboberfläche auf http://localhost:8770
python3 mitreden.py build     # rendern, was fehlt
python3 mitreden.py backends  # was ist gerade nutzbar?
```

Das Repo ist absichtlich klein: eine Datei Python, keine Abhängigkeiten, ein
bisschen ffmpeg. Der Code ist auf Englisch, alles zum Lesen und Hören auf
Deutsch. Nur was das Terminal ausgibt, ist englisch geblieben.

## Was du brauchst

Python 3 und `ffmpeg`. Sonst nichts — keine pip-Pakete, kein Framework.

```
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Debian/Ubuntu
```

Dazu eine Stimme. `say` (macOS) und `espeak` (Linux) sind schon da und kosten
nichts, klingen aber roboterhaft — gut genug, um zu prüfen, ob die Kette läuft.
Für den echten Einsatz siehe [Die Stimme wählen](#die-stimme-wählen).

## Loslegen

```
cp phrases.example.json phrases.json
python3 mitreden.py backends   # welches Backend steht bei dir auf "found"?
```

In `config.json` das passende Backend eintragen, dann:

```
python3 mitreden.py ui
```

Auf <http://localhost:8770> Sätze eintippen — eine Zeile pro Satz —,
„Satz hinzufügen“ drücken. Die Audiodateien landen in `out/`.

Ohne Oberfläche geht es genauso:

```
python3 mitreden.py add "Ich brauche Hilfe." --tags notfall
python3 mitreden.py build        # nur Neues/Geändertes
python3 mitreden.py build --all  # alles neu, nach einem Stimmwechsel
python3 mitreden.py delete ich-brauche-hilfe
```

## Was rauskommt

Pro Satz eine Datei in `out/`, benannt nach seiner ID. Standard ist WAV mit
44,1 kHz mono; das Format steht in `config.json` und kann alles sein, was
ffmpeg schreiben kann:

```json
{ "output": { "format": "wav", "sample_rate": 44100, "channels": 1 } }
```

`"mp3"` spart Platz, ein kleineres `sample_rate` hilft, wenn das Zielgerät
wenig Speicher hat. Nach einer Änderung einmal `build` — mitreden merkt selbst,
dass neu gerendert werden muss, und räumt die alten Dateien weg.

Jede Datei ist stillebereinigt und auf −16 LUFS normalisiert. Ohne das ist ein
Satz kaum hörbar und der nächste brüllt.

## Die Stimme wählen

Das Backend steht in `config.json`. Umstellen, dann einmal
`python3 mitreden.py build --all`.

**`say` / `espeak`** — schon da, kein Setup, kein Konto. Roboterhaft, aber der
schnellste Weg zu prüfen, ob alles läuft.

```json
{ "backend": "say", "say": { "voice": "Anna" } }
```

**`piper`** — lokal, offline, kostenlos, quelloffen. Deutsche Modelle gibt es
[fertig zum Herunterladen](https://github.com/rhasspy/piper). Läuft in zehn
Jahren noch genauso, ohne Konto und ohne Abo.

**`azure`** — neuronale Stimmen über die Cloud, klingt deutlich lebendiger als
alles Lokale. Kostenlose Stufe (F0) reicht für diese Mengen meist aus.
`rate` und `pitch` gelten für die erzeugten Dateien und wirken nach einem
`build --all`.

```json
{ "backend": "azure",
  "azure": { "voice": "de-DE-GiselaNeural", "region": "germanywestcentral",
             "key_env": "AZURE_SPEECH_KEY", "rate": "-5%", "pitch": "0%" } }
```

**`elevenlabs`** — kann eine echte Stimme klonen. Qualitativ das Beste, dafür
Abo und Cloud — und die Einwilligung der Person, deren Stimme du klonst.

Schlüssel stehen **nie** in einer Datei im Repo, sondern in einer
Umgebungsvariablen. In `config.json` steht mit `key_env` nur der *Name*:

```
export AZURE_SPEECH_KEY="dein-schluessel"
```

Dauerhafter geht es mit einer `.env` neben `mitreden.py`, die beim Start
gelesen wird und in `.gitignore` steht:

```
AZURE_SPEECH_KEY=dein-schluessel
```

Wenn du dich für eine Cloud-Stimme entscheidest: sichere die erzeugten Dateien
zusätzlich. Ein Dienst kann verschwinden, eine lokale Datei nicht.

## Gruppen, Suche, Download

Ab ein paar Dutzend Sätzen willst du Ordnung. mitreden nimmt dafür **Gruppen,
keine Ordner** — ein Satz kann in mehreren stecken:

```json
{ "id": "ich-brauche-hilfe", "text": "Ich brauche Hilfe.",
  "tags": ["kindergarten", "zuhause", "notfall"] }
```

Über der Liste stehen die Gruppen zum Anklicken, daneben ein Suchfeld. Mehrere
Gruppen lassen sich gleichzeitig wählen und verknüpfen mit ODER; der Freitext
schränkt zusätzlich ein. Die Suche läuft im Browser, ohne Warten, über Text
*und* Gruppennamen, und ist tolerant bei Umlauten: `hor auf`, `hoer auf` und
`Hör auf` finden alle denselben Satz.

Die Leiste zeigt die zwölf meistgenutzten Gruppen und klappt den Rest hinter
„+ n weitere“ weg. Alles Weitere zu einem Satz steckt im ⋮ am rechten Rand
seiner Zeile.

**Ein Text, eine Datei.** Legst du einen Satz an, den es schon gibt, entsteht
kein zweiter Eintrag — der vorhandene bekommt nur die neue Gruppe dazu. Groß-
und Kleinschreibung und zusätzliche Leerzeichen sind egal, Satzzeichen nicht:
„Nochmal!“ und „Nochmal.“ klingen verschieden, also sind es zwei Sätze.

```
python3 mitreden.py dedupe           # zeigt, was zusammengeführt würde
python3 mitreden.py dedupe --apply   # führt es wirklich zusammen
```

Ohne `--apply` wird nichts angefasst.

**Herunterladen.** Der Knopf packt genau die Sätze zusammen, die die Liste
gerade zeigt — nach einer Suche also die Treffer, in einer Gruppe deren Sätze.
Auf der Kommandozeile:

```
python3 mitreden.py export kindergarten ~/Desktop/kiga
python3 mitreden.py export all ~/Desktop/alles
```

## Deine Inhalte bleiben lokal

Im Repo liegt nur `phrases.example.json` als Startpunkt. Deine eigene
`phrases.json`, alles daraus Erzeugte und deine Schlüssel sind in `.gitignore`
eingetragen und wandern nie mit:

```
phrases.json        deine Sätze
phrases.json.*      Sicherungskopien davon
out/  build/        alles daraus Erzeugte
*.wav *.mp3 *.aiff  Audio, wo auch immer es auftaucht
.env  .env.*        Schlüssel
```

Weil `out/` sich jederzeit neu erzeugen lässt, ist das kein Verlust — nur
`phrases.json` selbst ist es wert, gesichert zu werden. Nimm dafür ein
privates Repo oder ein Backup außerhalb von git.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Mach damit, was du willst.
