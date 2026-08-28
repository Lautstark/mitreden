/* A zip writer.
 *
 * Stored rather than deflated: mp3 and wav-from-mp3 do not compress, so the
 * only thing deflate would buy is a dependency.
 *
 * (Two things used to stand here that no longer do: this paragraph a second
 * time a few lines down, and a note calling this "one piece of mitreden's
 * browser backend, which app/backend.js assembles". There is no app/backend.js
 * — it went with the container, and the callers are src/ui/list.ts and
 * src/ui/settings.ts.)
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export function zip(files: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const chunks: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  // A zip carries an MS-DOS timestamp. Left at zero it reads as day 0 of
  // month 0, which some extractors show and others refuse.
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const { name, bytes } of files) {
    const nb = enc.encode(name), crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);        // the name is UTF-8
    local.setUint16(8, 0, true);             // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nb.length, true);
    chunks.push(new Uint8Array(local.buffer), nb, bytes);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, bytes.length, true);
    dir.setUint32(24, bytes.length, true);
    dir.setUint16(28, nb.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nb);
    offset += 30 + nb.length + bytes.length;
  }
  const dirBytes = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirBytes, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)],
                  { type: 'application/zip' });
}
