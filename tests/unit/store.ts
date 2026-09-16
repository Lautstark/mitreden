/*
 * Everything src/db/ exports, under one name, for the tests that reload the
 * store between cases.
 *
 * db-migration, db-refusal and db-schema each seed an IndexedDB by hand and
 * then `await import()` the store fresh, so that the open they are testing is
 * the first one. When db/db.ts held every store that was one import; now that
 * the connection, the stores and the folder are modules of their own it would
 * be six, repeated in each of the three. This is the one place they are
 * gathered, and it is a test file rather than a barrel in src/ because nothing
 * in the program wants all of them at once.
 */
export * from '../../src/db/db.ts';
export * from '../../src/db/phrases.ts';
export * from '../../src/db/collections.ts';
export * from '../../src/db/settings.ts';
export * from '../../src/db/audio.ts';
export * from '../../src/db/mirror.ts';
export * from '../../src/db/wipe.ts';
