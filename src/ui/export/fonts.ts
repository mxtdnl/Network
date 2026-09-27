// Fonts for exports. The self-hosted Fira files (CLAUDE.md D18) are the only
// fonts: the SVG embeds the WOFF2 files it needs as data URIs, and the PDF
// embeds subsets of TrueType fonts converted from the WOFF files (D106). Files
// are fetched from the site itself, which the CSP allows (connect-src 'self').

import type { FontRole } from './document';

export type Subset = 'latin' | 'latin-ext';
export type Face = 'sans-400' | 'sans-500' | 'sans-600' | 'condensed-500';

/** The face each text role is set in (design-system §3.2). */
export const ROLE_FACE: Record<FontRole, Face> = {
  label: 'condensed-500',
  group: 'sans-600',
  regular: 'sans-400',
  medium: 'sans-500',
};

/** Base name of a font file in src/assets/fonts. */
export function fontFile(face: Face, subset: Subset, ext: 'woff' | 'woff2'): string {
  const [family, weight] = face.split('-') as [string, string];
  const name = family === 'sans' ? 'fira-sans' : 'fira-sans-condensed';
  return `${name}-${subset}-${weight}-normal.${ext}`;
}

/** Reads a font file by base name: fetched in the browser, read from disk in tests. */
export type FontLoader = (file: string) => Promise<Uint8Array>;

// The Latin subset's unicode-range (src/styles/fonts.css).
const LATIN_RANGES: [number, number][] = [
  [0x0000, 0x00ff],
  [0x0131, 0x0131],
  [0x0152, 0x0153],
  [0x02bb, 0x02bc],
  [0x02c6, 0x02c6],
  [0x02da, 0x02da],
  [0x02dc, 0x02dc],
  [0x0304, 0x0304],
  [0x0308, 0x0308],
  [0x0329, 0x0329],
  [0x2000, 0x206f],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
];

export function inLatin(codePoint: number): boolean {
  return LATIN_RANGES.some(([a, b]) => codePoint >= a && codePoint <= b);
}

export const LATIN_RANGE_CSS =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
export const LATIN_EXT_RANGE_CSS =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

/** True when some character needs the Latin Extended file. */
export function needsLatinExt(texts: Iterable<string>): boolean {
  for (const s of texts) for (const ch of s) if (!inLatin(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Inflates zlib data (a WOFF table); DecompressionStream in the browser, node:zlib in tests. */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export const browserInflate: Inflate = async (data) => {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * Converts a WOFF (version 1) file to the TrueType or OpenType file it wraps:
 * each table is inflated when compressed and the table directory is rebuilt
 * (W3C WOFF 1.0, section 5). Checksums are carried over unchanged.
 */
export async function woffToSfnt(woff: Uint8Array, inflate: Inflate): Promise<Uint8Array> {
  const src = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (src.getUint32(0) !== 0x774f4646) throw new Error('Not a WOFF file.');
  const flavor = src.getUint32(4);
  const numTables = src.getUint16(12);
  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const offset = src.getUint32(o + 4);
    const compLength = src.getUint32(o + 8);
    const origLength = src.getUint32(o + 12);
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({
      tag: src.getUint32(o),
      checksum: src.getUint32(o + 16),
      data: compLength < origLength ? await inflate(raw) : raw,
    });
  }
  let selector = 0;
  while (2 ** (selector + 1) <= numTables) selector += 1;
  const searchRange = 2 ** selector * 16;
  let size = 12 + 16 * numTables;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dst = new DataView(out.buffer);
  dst.setUint32(0, flavor);
  dst.setUint16(4, numTables);
  dst.setUint16(6, searchRange);
  dst.setUint16(8, selector);
  dst.setUint16(10, numTables * 16 - searchRange);
  let offset = 12 + 16 * numTables;
  tables.forEach((t, i) => {
    const d = 12 + i * 16;
    dst.setUint32(d, t.tag);
    dst.setUint32(d + 4, t.checksum);
    dst.setUint32(d + 8, offset);
    dst.setUint32(d + 12, t.data.length);
    out.set(t.data, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}
