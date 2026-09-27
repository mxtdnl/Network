// Byte helpers for survey links, packages and responses. Written by hand
// because Uint8Array.toBase64 is too recent for the respondent route's
// minimum browsers (CLAUDE.md, "Research").

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url without padding (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const rest = Math.min(3, bytes.length - i);
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    for (let k = 0; k <= rest; k++) out += B64.charAt((n >> (18 - 6 * k)) & 63);
  }
  return out;
}

export class EncodingError extends Error {}

/** Decodes base64url without padding; throws EncodingError on any other character. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4 === 1) throw new EncodingError('Invalid base64url length.');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64.indexOf(text.charAt(i));
    if (v === -1) throw new EncodingError('Invalid base64url character.');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 255;
    }
  }
  return out;
}

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
export const fromUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

// Crockford base32 has no I, L, O or U, so a receipt read aloud or typed from
// a phone is not misread.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The first 40 bits of `bytes` as eight Crockford base32 characters, "XXXX-XXXX". */
export function receiptFromHash(bytes: Uint8Array): string {
  let n = 0n;
  for (let i = 0; i < 5; i++) n = (n << 8n) | BigInt(bytes[i] ?? 0);
  let out = '';
  for (let i = 7; i >= 0; i--) out += CROCKFORD.charAt(Number((n >> BigInt(i * 5)) & 31n));
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
