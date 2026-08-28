/**
 * What the footer used to try to say in five words: what this is, what leaves
 * the machine, and the two pages § 5 DDG and Art. 13 DSGVO require. bildhaft's
 * shape — dialogs in the app, not pages beside it.
 *
 * The legal pages are German because the obligation is; the about follows the
 * page's language.
 */

import { lang } from '../i18n/index.ts';
import { el } from './dom.ts';

const REPO = 'https://github.com/Lautstark/mitreden';
const ORG = 'https://github.com/Lautstark';
const BILDHAFT = 'https://lautstark.github.io/bildhaft/';
const AVERY_6222 = 'https://www.avery-zweckform.com/vorlage-6222';
const AVERY_L6019 = 'https://www.avery-zweckform.com/vorlage-l6019';
const ISSUES = 'https://github.com/Lautstark/mitreden/issues';

/** The one line to change if a different address should be public. */
const EMAIL = 'steffi@lautstark.tech';

const ext = (href: string, text: string): string =>
  `<a href="${href}" target="_blank" rel="noreferrer noopener">${text}</a>`;

const h3 = (text: string, first = false): string =>
  `<h3 style="font-size:14px;margin:${first ? '0' : '18px'} 0 6px">${text}</h3>`;

function page(title: string, html: string): void {
  const dialog = el<HTMLDialogElement>('info');
  el('infotitle').textContent = title;
  el('infobody').innerHTML = html;
  dialog.showModal();
}

const ABOUT = {
  de: `
    <p style="margin-top:0">
      mitreden macht aus getippten Sätzen fertige Audiodateien, damit Sprechtaste,
      Lesestift und Handy mit derselben Stimme sprechen. Gedacht für Eltern,
      Lehrkräfte und Therapeut:innen, die mit einem nicht sprechenden Kind arbeiten.
    </p>
    ${h3('Was den Rechner verlässt')}
    <p style="margin:0">
      Deine Sätze und deine Aufnahmen bleiben in diesem Browser. Die Stimme wird
      beim ersten Mal geladen — etwa 60 MB, von dort, wo das piper-Projekt sie
      selbst veröffentlicht (Hugging Face) — und bleibt dann auf deinem Gerät.
      Danach geht es ganz ohne Netz. Nur wenn du selbst einen Azure-Schlüssel
      einträgst, gehen Sätze zum Aufnehmen direkt an Microsoft. Es gibt keinen
      Server von uns, keine Konten und keine Auswertung.
    </p>
    ${h3('Stimmen')}
    <p style="margin:0">
      Die mitgelieferten Stimmen stammen aus dem
      ${ext('https://github.com/rhasspy/piper', 'piper-Projekt')} und sind frei
      verwendbar; welche das sind, entscheidet
      ${ext('https://github.com/Lautstark/stimmquelle', 'stimmquelle')}, damit
      keine Stimme mit unklarer Lizenz auf einem Gerät landet.
    </p>
    ${h3('Der Anybook-Stift')}
    <p style="margin:0">
      mitreden kann den Stift nicht selbst beschreiben. Er meldet sich als
      serielle Schnittstelle und spricht ein Protokoll, das nur Anybook Studio
      kennt. Was mitreden abnimmt, ist alles davor: die Aufnahmen im richtigen
      Format, der fertige Bogen, und jeder Code schon an seinem Satz. In Studio
      bleibt öffnen, übertragen, drucken.
    </p>
    <p style="margin:8px 0 0">
      Gedruckt wird ohne Skalierung, auf
      ${ext(AVERY_6222, 'Avery Zweckform 6222')} (Ø 20 mm, 88 Etiketten je Bogen)
      oder ${ext(AVERY_L6019, 'L6019')} (Ø 10 mm, 315 je Bogen). Der Bogen wird
      beim Export gewählt. Auf dem kleinen ist zwischen den Etiketten kein Platz
      für ein Wort, die Aufkleber tragen also keine Beschriftung und stehen in
      der Reihenfolge der Liste.
      Der erste Aufkleber ist der Startcode. Er trägt kein Wort, und ohne ihn
      lässt sich der Bogen später auf keinem zweiten Stift verwenden, weder auf
      einem Ersatzstift noch auf dem im Kindergarten.
    </p>
    ${h3('Quellcode und Schwesterprojekt')}
    <p style="margin:0">
      mitreden ist quelloffen (MIT): ${ext(REPO, 'github.com/Lautstark/mitreden')}.
      Die übrigen Werkzeuge liegen unter ${ext(ORG, 'Lautstark')}.
      ${ext(BILDHAFT, 'bildhaft')} ist das Schwesterprojekt: Satz eintippen,
      Symbolstreifen zum Ausdrucken zurückbekommen.
    </p>`,
  en: `
    <p style="margin-top:0">
      mitreden turns typed sentences into finished audio files, so a talker
      button, a reading pen and a phone all speak in the same voice. Made for
      parents, teachers and therapists working with a non-speaking child.
    </p>
    ${h3('What leaves the machine')}
    <p style="margin:0">
      Your sentences and recordings stay in this browser. The voice is downloaded
      once — about 60 MB, from where the piper project publishes it (Hugging
      Face) — and then stays on your device; after that it works with no network
      at all. Only if you enter an Azure key yourself do sentences go directly to
      Microsoft to be recorded. There is no server of ours, no accounts and no
      analytics.
    </p>
    ${h3('Voices')}
    <p style="margin:0">
      The shipped voices come from the
      ${ext('https://github.com/rhasspy/piper', 'piper project')} and are free to
      use; which ones qualify is decided by
      ${ext('https://github.com/Lautstark/stimmquelle', 'stimmquelle')}, so no
      voice with an unclear licence ends up on a child's device.
    </p>
    ${h3('The Anybook pen')}
    <p style="margin:0">
      mitreden cannot write to the pen itself. It appears as a serial port and
      speaks a protocol only Anybook Studio knows. What mitreden takes off you
      is everything before that: the recordings in the right format, the finished
      sheet, and every code already bound to its sentence. What is left in Studio
      is open, transfer, print.
    </p>
    <p style="margin:8px 0 0">
      Print without scaling, on
      ${ext(AVERY_6222, 'Avery Zweckform 6222')} (Ø 20 mm, 88 labels per sheet)
      or ${ext(AVERY_L6019, 'L6019')} (Ø 10 mm, 315 per sheet). The sheet is
      chosen at export. On the small one there is no room between labels for a
      word, so those stickers carry no caption and stand in the order of the
      list. The
      first sticker is the start code. It carries no word, and without it the
      sheet can never be used on a second pen, neither a replacement nor the one
      at kindergarten.
    </p>
    ${h3('Source code and sister project')}
    <p style="margin:0">
      mitreden is open source (MIT): ${ext(REPO, 'github.com/Lautstark/mitreden')}.
      The other tools live under ${ext(ORG, 'Lautstark')}.
      ${ext(BILDHAFT, 'bildhaft')} is the sister project: type a sentence, get a
      printable symbol strip back.
    </p>`,
};

export const openAbout = (): void =>
  page(lang() === 'de' ? 'Was ist mitreden?' : 'What is mitreden?', ABOUT[lang()]);

/** Pflichtangaben nach § 5 DDG — deutsch, weil die Pflicht es ist. */
export const openImpressum = (): void => page('Impressum', `
  ${h3('Angaben gemäß § 5 DDG', true)}
  <p style="margin:0">
    Stefanie Grewenig<br>Talheide 5<br>21149 Hamburg<br>Deutschland
  </p>
  ${h3('Kontakt')}
  <p style="margin:0">
    E-Mail: <a href="mailto:${EMAIL}">${EMAIL}</a><br>
    Fehler und Fragen auch öffentlich:
    ${ext(ISSUES, 'github.com/Lautstark/mitreden/issues')}
  </p>
  ${h3('Verantwortlich für den Inhalt')}
  <p style="margin:0">Stefanie Grewenig, Anschrift wie oben.</p>
  ${h3('Stimmen und Quellcode')}
  <p style="margin:0">
    mitreden ist ein privates, nicht kommerzielles Projekt. Der Quellcode steht
    unter der MIT-Lizenz. Die mitgelieferten Stimmen stammen aus dem
    ${ext('https://github.com/rhasspy/piper', 'piper-Projekt')} und tragen ihre
    eigenen freien Lizenzen; sie sind nicht Teil dieser Software.
  </p>
  ${h3('Haftung für Links')}
  <p style="margin:0">
    Für die Inhalte verlinkter externer Seiten sind deren Betreiber
    verantwortlich. Zum Zeitpunkt der Verlinkung waren dort keine Rechtsverstöße
    erkennbar.
  </p>
  ${h3('Streitbeilegung')}
  <p style="margin:0">
    Zur Teilnahme an einem Streitbeilegungsverfahren vor einer
    Verbraucherschlichtungsstelle bin ich weder verpflichtet noch bereit.
  </p>`);

/** Art. 13 DSGVO. Kurz, weil fast nichts passiert: es gibt keinen Server. */
export const openDatenschutz = (): void => page('Datenschutz', `
  <p style="margin-top:0">
    mitreden läuft vollständig in deinem Browser. Es gibt keinen Server von uns,
    keine Konten, keine Auswertung und keine Werbung. Deine Sätze und Aufnahmen
    verlassen deinen Rechner nicht — ich kann sie nicht sehen, auch nicht auf
    Nachfrage.
  </p>
  ${h3('Verantwortliche')}
  <p style="margin:0">
    Stefanie Grewenig, Talheide 5, 21149 Hamburg, Deutschland<br>
    <a href="mailto:${EMAIL}">${EMAIL}</a>
  </p>
  ${h3('Hosting und Server-Logs')}
  <p style="margin:0">
    Die Seite wird von GitHub Pages ausgeliefert (GitHub, Inc., 88 Colin P. Kelly
    Jr. Street, San Francisco, CA 94107, USA). Beim Abruf verarbeitet GitHub
    technisch notwendige Zugriffsdaten, darunter deine IP-Adresse. Ich habe
    darauf keinen Zugriff. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; die
    Übermittlung in die USA stützt sich auf das EU-US Data Privacy Framework,
    unter dem GitHub zertifiziert ist.
  </p>
  ${h3('Stimmen von Hugging Face')}
  <p style="margin:0">
    Beim ersten Aufnehmen lädt dein Browser das Stimmmodell von Hugging Face
    (Hugging Face, Inc., 20 Jay Street, Brooklyn, NY 11201, USA). Dabei sieht
    Hugging Face deine IP-Adresse — wie bei jedem Download. Der Inhalt deiner
    Sätze wird dabei nicht übertragen. Danach liegt die Stimme auf deinem Gerät
    und es findet kein weiterer Abruf statt.
  </p>
  ${h3('Azure Speech, nur auf eigenen Wunsch')}
  <p style="margin:0">
    Trägst du einen eigenen Azure-Schlüssel ein, gehen die Sätze, die du
    aufnimmst, direkt von deinem Browser an Microsoft (Microsoft Ireland
    Operations Ltd.). Das ist dein Vertragsverhältnis mit Microsoft; der
    Schlüssel bleibt in deinem Browser und mitreden überträgt ihn an niemanden
    sonst.
  </p>
  ${h3('Deine Rechte')}
  <p style="margin:0">
    Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit,
    Widerspruch und Beschwerde bei einer Aufsichtsbehörde — wobei hier schlicht
    nichts vorliegt, worüber Auskunft zu geben wäre.
  </p>`);
