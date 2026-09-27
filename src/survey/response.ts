// Encrypted survey responses (spec §15.2, §15.4).
//
// The body (answers, token, time) is compressed and sealed to the analyst's
// public key. The envelope keeps the survey id, version and key fingerprint in
// the clear so the dashboard can sort files before decrypting; they are bound
// as additional authenticated data, so altering them makes decryption fail.
// Files and pasted text use the same armoured text block.

import { fromBase64Url, fromUtf8, receiptFromHash, sha256, toBase64Url, utf8 } from './bytes';
import { deflate, inflate } from './compress';
import { open, seal, type Sealed } from './crypto';

export const RESPONSE_FORMAT = 'graticule-response';
export const RESPONSE_VERSION = 1;
const BEGIN = '-----BEGIN GRATICULE RESPONSE-----';
const END = '-----END GRATICULE RESPONSE-----';
const LINE = 64;

export type Answer = number | string | null;

export interface ResponseBody {
  survey_id: string;
  version: number;
  position: number;
  token: string;
  /** ISO time on the respondent's device; decides between duplicates. */
  submitted_at: string;
  /** Roster positions selected in the nomination stage; null for full roster. */
  nominated: number[] | null;
  /** Per layer key, one entry per roster position; null where not answered. */
  answers: Record<string, Answer[]>;
}

export interface Envelope extends Sealed {
  format: typeof RESPONSE_FORMAT;
  v: typeof RESPONSE_VERSION;
  survey_id: string;
  version: number;
  /** Fingerprint of the analyst key the response is sealed to. */
  kid: string;
}

export class EnvelopeError extends Error {}

export const aadFor = (e: Pick<Envelope, 'survey_id' | 'version' | 'kid'>) =>
  utf8(
    `${RESPONSE_FORMAT}/${String(RESPONSE_VERSION)}|${e.survey_id}|${String(e.version)}|${e.kid}`,
  );

export async function encryptResponse(
  body: ResponseBody,
  publicKey: string,
  keyFingerprint: string,
): Promise<Envelope> {
  const header = { survey_id: body.survey_id, version: body.version, kid: keyFingerprint };
  const sealed = await seal(publicKey, aadFor(header), await deflate(utf8(JSON.stringify(body))));
  return { format: RESPONSE_FORMAT, v: RESPONSE_VERSION, ...header, ...sealed };
}

const envelopeJson = (e: Envelope) =>
  JSON.stringify({
    format: e.format,
    v: e.v,
    survey_id: e.survey_id,
    version: e.version,
    kid: e.kid,
    epk: e.epk,
    salt: e.salt,
    iv: e.iv,
    ct: e.ct,
  });

/** The text a respondent pastes into an email or saves as a file. */
export function armour(e: Envelope): string {
  const body = toBase64Url(utf8(envelopeJson(e)));
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += LINE) lines.push(body.slice(i, i + LINE));
  return `${BEGIN}\n${lines.join('\n')}\n${END}\n`;
}

/** Short code both sides can quote: from the SHA-256 of the envelope. */
export async function receiptCode(e: Envelope): Promise<string> {
  return receiptFromHash(await sha256(utf8(envelopeJson(e))));
}

export const responseFileName = (receipt: string) =>
  `graticule-response-${receipt.replace('-', '')}.txt`;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function toEnvelope(v: unknown): Envelope {
  const e = v as Record<string, unknown>;
  if (
    typeof v !== 'object' ||
    v === null ||
    e.format !== RESPONSE_FORMAT ||
    e.v !== RESPONSE_VERSION ||
    !isStr(e.survey_id) ||
    !isInt(e.version) ||
    !isStr(e.kid) ||
    !isStr(e.epk) ||
    !isStr(e.salt) ||
    !isStr(e.iv) ||
    !isStr(e.ct)
  )
    throw new EnvelopeError('Not a Graticule response.');
  return e as unknown as Envelope;
}

export interface ArmourResult {
  envelopes: Envelope[];
  /** Blocks that were found but could not be read. */
  unreadable: number;
}

/**
 * Finds every response block in a text: a file, or one or more blocks pasted
 * from emails. Email clients may re-wrap lines, add quote marks ("> ") or
 * spaces, so everything but base64url characters is dropped inside a block.
 */
export function readArmoured(text: string): ArmourResult {
  const envelopes: Envelope[] = [];
  let unreadable = 0;
  let at = text.indexOf(BEGIN);
  while (at !== -1) {
    const end = text.indexOf(END, at + BEGIN.length);
    if (end === -1) {
      unreadable++;
      break;
    }
    const inner = text.slice(at + BEGIN.length, end).replace(/[^A-Za-z0-9_-]/g, '');
    try {
      envelopes.push(toEnvelope(JSON.parse(fromUtf8(fromBase64Url(inner)))));
    } catch {
      unreadable++;
    }
    at = text.indexOf(BEGIN, end + END.length);
  }
  return { envelopes, unreadable };
}

function toBody(v: unknown): ResponseBody {
  const b = v as Record<string, unknown>;
  const answers: unknown = b.answers;
  const ok =
    typeof v === 'object' &&
    v !== null &&
    isStr(b.survey_id) &&
    isInt(b.version) &&
    isInt(b.position) &&
    isStr(b.token) &&
    isStr(b.submitted_at) &&
    !Number.isNaN(Date.parse(b.submitted_at)) &&
    (b.nominated === null || (Array.isArray(b.nominated) && b.nominated.every(isInt))) &&
    typeof answers === 'object' &&
    answers !== null &&
    Object.values(answers as Record<string, unknown>).every(
      (list) =>
        Array.isArray(list) &&
        list.every((a) => a === null || isStr(a) || (typeof a === 'number' && Number.isFinite(a))),
    );
  if (!ok) throw new EnvelopeError('The response body is not in the expected form.');
  return v as ResponseBody;
}

/** Decrypts and checks a response. DecryptError: wrong key or altered; EnvelopeError: malformed. */
export async function decryptResponse(privateKey: CryptoKey, e: Envelope): Promise<ResponseBody> {
  const plain = await open(privateKey, e, aadFor(e));
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(await inflate(plain)));
  } catch {
    throw new EnvelopeError('The response body could not be read.');
  }
  const body = toBody(parsed);
  if (body.survey_id !== e.survey_id || body.version !== e.version)
    throw new EnvelopeError('The response body does not match its header.');
  return body;
}
