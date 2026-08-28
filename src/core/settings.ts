/** What the whole program agrees on: the output format, and which engine made
 *  a recording. */

import { PIPELINE_VERSION, VERSION } from '@lautstark/stimmquelle/browser';

/**
 * Fixed, because there is no file to edit and mp3 at 44.1 kHz mono is what
 * talkers, reading pens and phone apps expect.
 */
export const OUT = { format: 'mp3', sampleRate: 44100, channels: 1, bitrate: 192 } as const;

/**
 * What the Anybook Pro's own files are, and so what core/anybook.ts writes.
 *
 * Not a preference. Studio transcodes whatever it is handed down to 24 kHz
 * mono on import — the mp3s inside a project it saved are at this rate whatever
 * went in — so writing them here is not a conversion the pen needs, it is the
 * one conversion it was going to do anyway, done once and marked as done.
 * 48 kbps because that is what Studio's own transcode produced; the published
 * books sit at 24 and sound it.
 */
export const PEN = { format: 'mp3', sampleRate: 24000, channels: 1, bitrate: 48 } as const;

/**
 * Which engine made a recording. It goes into the fingerprint, so a build that
 * changes how a voice speaks must not leave old recordings sitting under names
 * claiming to match new ones.
 *
 * Both halves come from the package now rather than a string kept in step by
 * hand: the version is what npm resolved, and the pipeline number is what
 * stimmquelle bumps when the sound itself changes.
 */
export const ENGINE_VERSION = `stimmquelle@${VERSION} pipeline@${PIPELINE_VERSION}`;
