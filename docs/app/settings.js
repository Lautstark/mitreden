/* What the whole backend agrees on: the output format, and which engine made
 * a recording.
 *
 * One piece of mitreden's browser backend; app/backend.js assembles them.
 */

/* The catalogue is stimmquelle's, baked into the page by tools/build-site.py
 * beside the language strings, so the list of voices is data rather than code
 * and the same file serves mitreden and vorlaut. */
export const CATALOGUE = (window.STIMMQUELLE || { voices: [] }).voices;

/* Output settings. Fixed, because there is no file to edit and mp3 at 44.1 kHz
 * mono is what talkers, reading pens and phone apps expect. */
export const OUT = { format: 'mp3', sample_rate: 44100, channels: 1, bitrate: 192 };

/* Which engine made a recording, for the same reason mitreden.py carried
 * PIPER_VERSION: piper is what turns the text into sound, so a build that
 * changes how a voice speaks must not leave old recordings sitting under names
 * claiming to match new ones. Both halves are pinned in tools/vendor.lock.json
 * and `tools/vendor.py --check` fails if this disagrees with either. */
export const ENGINE_VERSION = 'vits-web@1.0.3 stimmquelle@0ff9af2';
