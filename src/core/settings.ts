/** What the whole program agrees on: the output format, and which engine made
 *  a recording. */

import { PIPELINE_VERSION, VERSION } from '@lautstark/stimmquelle/browser';

/**
 * Fixed, because there is no file to edit and mp3 at 44.1 kHz mono is what
 * talkers, reading pens and phone apps expect.
 */
export const OUT = { format: 'mp3', sampleRate: 44100, channels: 1, bitrate: 192 } as const;

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
