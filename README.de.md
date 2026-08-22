# mitreden

**Deutsch** · [English](README.md)

Ein Satz eingetippt, eine Audiodatei zurück — und alle klingen gleich.

Ich baue das für meine dreieinhalbjährige Tochter, die unterstützt
kommuniziert.

*Diese Seite bringt dich zum Laufen. Die ausführliche Anleitung — NAS,
Cloud-Stimmen, Formate, Sammlungen — steht auf [Englisch](README.md).*

## Wofür das gut ist

Wer unterstützt kommuniziert, spricht oft nicht über ein Gerät, sondern über
mehrere: eine Talker-App auf dem Tablet, einen Hörstift, einzelne Taster.
Jedes bringt von sich aus eine eigene Stimme mit. Derselbe Satz klingt dann je
nach Gerät wie eine andere Person — und wer gerade erst lernt, dass diese
Geräte die eigene Stimme sind, merkt das sofort.

mitreden dreht das um: Die Stimme wird einmal festgelegt, die Sätze stehen an
einer Stelle, und jedes Gerät bekommt dieselbe Audiodatei. Wechselst du später
die Stimme, macht ein Befehl alles wieder einheitlich.

Es ist kein Talker und ersetzt keinen. Es ist die Werkstatt dahinter: Text
rein, Audiodateien raus, im Format, das dein Gerät versteht.

## Loslegen

Du brauchst einen Browser. Sonst nichts.

**[mitreden öffnen](https://lautstark.github.io/mitreden/app/)** und lostippen
— eine Zeile pro Satz, dann „Satz hinzufügen". Kein Konto, kein Schlüssel,
nichts zu installieren, nichts, was laufen muss. Die Stimme wird einmal
geladen, etwa 60 MB beim ersten Mal, und bleibt dann auf deinem Gerät. Danach
entsteht jede Aufnahme im Tab, und nichts von dem, was du tippst, geht
irgendwohin.

Jeder Satz erscheint mit einem Abspieler in der Liste. Die gewünschten
anhaken und als MP3 oder WAV herunterladen — und von dort auf den Talker, den
Hörstift oder wohin sie sollen.

Die Sätze liegen in dem Browser, in dem du sie getippt hast. Das ist das eine,
wovon sich eine Kopie lohnt: **Einstellungen → Sätze in einer Datei sichern.**
Wer die Browserdaten löscht, löscht sie mit, und anders als die Audiodateien
lassen sie sich nicht wiederherstellen.

Das ist alles.

## Die Stimme wählen

Die Stimme steht neben „Satz hinzufügen". Sie entscheidet, womit aufgenommen
wird: Jeder neue Satz bekommt sie, bestehende behalten ihre, bis du sie
ankreuzt und „Stimme ändern" wählst. Eine Stimme für alles bleibt der
Normalfall — „Alle auswählen", einmal aufnehmen, fertig.

**Vier Piper-Stimmen stehen zur Wahl** — Thorsten und Thorsten (emotional) auf
Deutsch, Kristin und HFC female auf Englisch, alle vier CC0 oder gemeinfrei.
Damit spricht mitreden sofort, ohne Konto, ohne Schlüssel, ohne dass je etwas
dein Gerät verlässt.

Die Liste ist bewusst kurz und ausprobiert, nicht abgeschrieben: Alle `low`-
und `x_low`-Modelle scheitern im Browser, weshalb Kerstin fehlt — es gibt sie
nur als `low`. Eine Stimme, die man wählen kann und die dann nicht spricht,
wäre schlimmer als keine Auswahl.

Cloud-Stimmen gibt es auf der Webseite nicht. Ein Schlüssel auf einer
öffentlichen Seite wäre ein anderes Versprechen als das, was hier gilt; wer
Azure oder ElevenLabs nutzen möchte, tut das über die Kommandozeile.

## Deine Inhalte bleiben lokal

Deine Sätze, alles daraus Gemachte und deine Schlüssel stehen in `.gitignore`
und wandern nie mit. `phrases.json` ist das Einzige, was sich nicht wieder
erzeugen lässt — dafür lohnt eine Sicherung.

## Mehr

Alles Weitere steht in der [englischen Anleitung](README.md): Dauerbetrieb auf
dem NAS, eigene Piper-Modelle, Azure und ElevenLabs, Ausgabeformate, Sammlungen
und Suche, die Kommandozeile.

Fehlerberichte und Fragen sind willkommen — gern auf Deutsch.

## Verwandt

[bildhaft](https://github.com/SteffiPeTaffy/bildhaft) ist ein Schwesterprojekt:
deutschen Satz eintippen, eine Reihe UK-Piktogramme zurückbekommen,
korrigieren, ausdrucken. Läuft ebenfalls ganz im Browser. Es ist derselbe Satz,
zweimal gesehen — bildhaft gibt ihm Symbole, mitreden gibt ihm eine Stimme. Was
du dort exportierst, liest mitreden ein; ein übersetztes Bilderbuch musst du
nicht zweimal tippen.

Beide tragen dasselbe Zeichen, dieselbe Sprechblase, nur in anderer Farbe. Und
dasselbe Prinzip: bildhaft speichert Symbol-Verweise statt Bilder, mitreden
speichert Sätze statt Audio. So funktioniert die exportierte Datei bei dem, der
sie bekommt — egal, welche Symbole oder Stimmen dort da sind.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Mach damit, was du willst.
