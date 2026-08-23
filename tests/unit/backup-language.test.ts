import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../../src/i18n/index.ts';

/*
 * ui/dom.ts registers the menu's dismissal listeners at module scope, which is
 * right in a browser and throws in node. Stubbed before the import rather than
 * guarded in the source: the registration is correct where it runs, and this
 * is the same shape sicherung's own suite uses to load a module that expects a
 * world its tests do not have.
 */
globalThis.addEventListener ??= (() => undefined) as typeof globalThis.addEventListener;
const { ago } = await import('../../src/ui/backupFolder.ts');

/*
 * That the age of the last backup follows the language, live.
 *
 * mitreden changes language without reloading the page, and the settings
 * dialog can be open while it happens. The arithmetic behind "vor 3 Minuten"
 * moved into @lautstark/sicherung at v1.1.0, which builds its Intl formatter
 * per call for exactly this reason — but the locale still has to arrive from
 * here, and it arrives by calling lang() at the moment of formatting rather
 * than capturing it.
 *
 * Nothing above catches a regression in that. Hoisting `lang()` into a module
 * const is a tidy-looking edit that keeps every other test green: the string
 * stays a well-formed relative time in a real language, just not the one the
 * reader is now in. It is wrong only for the person who switched, which is
 * also the person least likely to be able to report it precisely.
 */

const NOW = Date.parse('2026-08-23T10:00:00Z');

// The page-local ago() takes a timestamp and reads the clock itself, which is
// the shape the panel wants and the reason the clock is pinned here instead.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); setLang('de'); });

describe('the age of the last copy', () => {
  it('is written in the language the page is in', () => {
    setLang('de');
    expect(ago(NOW - 5 * 60_000)).toMatch(/vor 5 Minuten/);
    setLang('en');
    expect(ago(NOW - 5 * 60_000)).toMatch(/5 minutes ago/);
  });

  it('follows a language change with no reload in between', () => {
    // The regression, exactly: the same call, three times, across two
    // switches. A locale captured at module load passes the first assertion
    // and fails the second.
    setLang('de');
    const german = ago(NOW - 3 * 3_600_000);
    setLang('en');
    const english = ago(NOW - 3 * 3_600_000);
    setLang('de');
    const germanAgain = ago(NOW - 3 * 3_600_000);

    expect(german).toMatch(/vor 3 Stunden/);
    expect(english).toMatch(/3 hours ago/);
    expect(germanAgain).toBe(german);
  });
});
