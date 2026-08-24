import { afterEach, describe, expect, it } from 'vitest';
import type { Status } from '@lautstark/sicherung';
import { LANGUAGES, setLang, type Lang } from '../../src/i18n/index.ts';

/*
 * ui/dom.ts registers the menu's dismissal listeners at module scope, which is
 * right in a browser and throws in node — the same stub backup-language.test.ts
 * takes, and for the same reason.
 */
globalThis.addEventListener ??= (() => undefined) as typeof globalThis.addEventListener;
const { ago, sentence } = await import('../../src/ui/backupFolder.ts');

/*
 * A backup that has stopped says how long it has been stopped.
 *
 * The last thing about this panel that is written out in all three products
 * with nothing checking they agree. @lautstark/sicherung/ui owns which buttons
 * a state offers, which states are somebody's to act on, and the arithmetic
 * behind „vor 3 Minuten" — and deliberately owns no words, because bildhaft has
 * no t() to route them through. So the sentences stayed here, and this rule
 * with them.
 *
 * `needs-permission` and `failed` both mean no backup is being written and it
 * will not resume by itself, and both are easy to put off: „es funktioniert
 * nicht" is a complaint, „seit elf Tagen nichts gesichert" is a deadline. The
 * age is what turns one into the other, and it is what a later edit tightening
 * a sentence drops without anything noticing — a sentence without an age is
 * still a sentence.
 *
 * Asserted against what ago() returns rather than against a literal, and run in
 * both languages: a German string quietly losing its {age} is invisible to a
 * test that only ever reads the English one.
 */

const at = Date.now() - 11 * 60_000;
const every = (body: (code: Lang) => void) =>
  (Object.keys(LANGUAGES) as Lang[]).forEach((code) => { setLang(code); body(code); });

afterEach(() => setLang('de'));

describe('what the backup panel says', () => {
  it('carries the age in both states that mean nothing is being written', () => {
    every((code) => {
      const age = ago(at);
      const permission: Status = { kind: 'needs-permission', folder: 'Sicherungen', lastWrite: at };
      const failed: Status = { kind: 'failed', folder: 'Sicherungen', lastWrite: at, reason: 'disk full' };
      expect(sentence(permission), code).toContain(age);
      expect(sentence(failed), code).toContain(age);
    });
  });

  it('says so where a folder was chosen and never written to', () => {
    // No age to give is not a reason to say nothing: „noch nie gesichert" is
    // the most alarming of the three answers, not the least.
    every(() => {
      for (const status of [
        { kind: 'needs-permission', folder: 'Sicherungen', lastWrite: null },
        { kind: 'failed', folder: 'Sicherungen', lastWrite: null, reason: 'disk full' },
        { kind: 'idle', folder: 'Sicherungen', lastWrite: null },
      ] as Status[]) {
        expect(sentence(status).length).toBeGreaterThan(0);
        // Not the age of the epoch, which is what a missing branch produces.
        expect(sentence(status)).not.toContain(ago(0));
      }
    });
  });

  it('names the folder wherever there is one, and the reason when it failed', () => {
    every(() => {
      expect(sentence({ kind: 'idle', folder: 'Sicherungen', lastWrite: at })).toContain('Sicherungen');
      expect(sentence({ kind: 'needs-permission', folder: 'Sicherungen', lastWrite: at }))
        .toContain('Sicherungen');
      expect(sentence({ kind: 'failed', folder: 'Sicherungen', lastWrite: at, reason: 'disk full' }))
        .toContain('disk full');
    });
  });

  it('says nothing at all where the browser has no picker', () => {
    expect(sentence({ kind: 'unsupported' })).toBe('');
  });
});
