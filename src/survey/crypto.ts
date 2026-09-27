// Survey cryptography (spec §15.2, CLAUDE.md D86). WebCrypto only.
//
// - The analyst's key pair is ECDH P-256. The private key is stored only
//   encrypted: PKCS #8, AES-256-GCM under a key from PBKDF2-HMAC-SHA-256 of
//   the passphrase (600,000 iterations, random salt).
// - Each response is encrypted to the analyst's public key with a fresh
//   ephemeral P-256 key pair: ECDH → HKDF-SHA-256 (random salt, fixed context)
//   → AES-256-GCM (random 96-bit IV), with the unencrypted header bound as
//   additional authenticated data.

import type { WrappedKey } from '../data/schema';
import { fromBase64Url, randomBytes, sha256, toBase64Url, utf8 } from './bytes';

const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
export const PBKDF2_ITERATIONS = 600_000;
/** HKDF context: names the response format version, so keys never cross formats. */
export const HKDF_INFO = 'graticule-response-v1';
export const MIN_PASSPHRASE_LENGTH = 12;

export class PassphraseError extends Error {}
export class DecryptError extends Error {}

export function generateAnalystKeyPair(): Promise<CryptoKeyPair> {
  // Extractable so the private key can be exported once, to be wrapped.
  return crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

/** First 16 bytes of the SHA-256 of the raw public key, base64url. */
export async function keyFingerprint(publicKey: string): Promise<string> {
  return toBase64Url((await sha256(fromBase64Url(publicKey))).slice(0, 16));
}

async function passphraseKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
) {
  const base = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapPrivateKey(
  privateKey: CryptoKey,
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<WrappedKey> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  const key = await passphraseKey(passphrase, salt, iterations);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pkcs8),
  );
  return {
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
  };
}

/** Decrypts the private key; a wrong passphrase (or altered key) throws PassphraseError. */
export async function unwrapPrivateKey(
  wrapped: WrappedKey,
  passphrase: string,
): Promise<CryptoKey> {
  let pkcs8: ArrayBuffer;
  try {
    const key = await passphraseKey(passphrase, fromBase64Url(wrapped.salt), wrapped.iterations);
    pkcs8 = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(wrapped.iv) },
      key,
      fromBase64Url(wrapped.ciphertext),
    );
  } catch {
    throw new PassphraseError('The passphrase does not open this key.');
  }
  return crypto.subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
}

async function aesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(HKDF_INFO) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

const importPublic = (raw: string) =>
  crypto.subtle.importKey('raw', fromBase64Url(raw), CURVE, false, []);

export interface Sealed {
  /** The respondent's ephemeral public key, raw, base64url. */
  epk: string;
  salt: string;
  iv: string;
  ct: string;
}

export async function seal(
  analystPublicKey: string,
  aad: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Sealed> {
  const ephemeral = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = await aesKey(
    ephemeral.privateKey,
    await importPublic(analystPublicKey),
    salt,
    'encrypt',
  );
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext,
  );
  return {
    epk: await exportPublicKey(ephemeral.publicKey),
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ct)),
  };
}

/** Throws DecryptError when authentication fails: the wrong key, or altered data. */
export async function open(
  privateKey: CryptoKey,
  sealed: Sealed,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const key = await aesKey(
      privateKey,
      await importPublic(sealed.epk),
      fromBase64Url(sealed.salt),
      'decrypt',
    );
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(sealed.iv), additionalData: aad },
      key,
      fromBase64Url(sealed.ct),
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptError('The response failed authentication.');
  }
}

/** What the respondent route needs from the browser (spec §15.4, supported browsers). */
export function missingFeatures(): string[] {
  const missing: string[] = [];
  if (!globalThis.isSecureContext) missing.push('secureContext');
  // Outside a secure context `crypto.subtle` is undefined although the types say otherwise.
  const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  if (subtle === undefined) missing.push('webCrypto');
  if (typeof globalThis.CompressionStream === 'undefined') missing.push('compressionStream');
  if (typeof globalThis.DecompressionStream === 'undefined') missing.push('decompressionStream');
  return missing;
}
