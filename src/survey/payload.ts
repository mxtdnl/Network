// Survey links and packages (spec §15.3).
//
// A link carries the whole survey in its fragment:
//   <base>#/respond/<base64url(deflate(JSON))>
// A package is one shared file with the same payload minus the personal
// fields; each person gets a short link naming the survey, their roster
// position, their token and the package's fingerprint:
//   <base>#/respond/p/<survey id>.<position>.<token>.<fingerprint>
// The fingerprint lets the page refuse a substituted package (CLAUDE.md D89).
// The payload is a JSON array rather than an object to keep links short; its
// first element is the format version.

import { fromBase64Url, fromUtf8, sha256, toBase64Url, utf8 } from './bytes';
import { deflate, inflate } from './compress';
import type { ScaleType, SurveyEntry, SurveyLayer, SurveyTexts } from '../data/schema';

export const PAYLOAD_FORMAT = 1;
/** Longest link issued; longer surveys use a package (CLAUDE.md D84). */
export const LINK_BUDGET = 2000;
export const PACKAGE_FORMAT = 'graticule-survey';
export const PACKAGE_EXTENSION = '.graticule-survey';
export const RESPOND_PREFIX = '#/respond/';

export interface RosterEntry {
  name: string;
  /** Values of the shared attributes, in `attributeLabels` order. */
  attributes: (string | null)[];
}

/** Everything a respondent's page needs, and nothing more (spec §15.3). */
export interface SurveyPayload {
  surveyId: string;
  version: number;
  title: string;
  roster: RosterEntry[];
  attributeLabels: string[];
  layers: SurveyLayer[];
  entry: SurveyEntry;
  nominationQuestion: string;
  /** Roster positions every respondent is asked about (D103). */
  required: number[];
  texts: SurveyTexts;
  deadline: string | null;
  estimateMinutes: number;
  publicKey: string;
  keyFingerprint: string;
}

export interface Personal {
  position: number;
  token: string;
}

export class PayloadError extends Error {}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function layerToJson(l: SurveyLayer): Json {
  return [
    l.key,
    l.label,
    l.question_wording,
    l.scale_type,
    l.min,
    l.max,
    l.signed ? 1 : 0,
    l.scale_labels ?? null,
    l.categories ?? null,
    l.category_labels ?? null,
    l.unselected === 'zero' ? 1 : 0,
    l.offer_not_applicable ? 1 : 0,
  ];
}

function toJson(p: SurveyPayload, personal: Personal | null): Json {
  return [
    PAYLOAD_FORMAT,
    p.surveyId,
    p.version,
    p.title,
    p.roster.map((r) => r.name),
    p.attributeLabels,
    p.attributeLabels.length > 0 ? p.roster.map((r) => r.attributes) : [],
    p.layers.map(layerToJson),
    p.entry === 'nominate' ? 1 : 0,
    p.nominationQuestion,
    p.required,
    p.texts.introduction,
    p.texts.confidentiality,
    p.texts.return_instructions,
    p.deadline,
    p.estimateMinutes,
    p.publicKey,
    p.keyFingerprint,
    personal ? personal.position : null,
    personal ? personal.token : null,
  ];
}

const SCALES = new Set(['strength', 'frequency', 'signed', 'categorical']);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(isStr);

function fail(): never {
  throw new PayloadError('The survey data is not in the expected form.');
}

function layerFromJson(v: unknown): SurveyLayer {
  if (!Array.isArray(v) || v.length !== 12) fail();
  const [key, label, q, scale, min, max, signed, sl, cats, cl, zero, na] = v as unknown[];
  if (!isStr(key) || !isStr(label) || !isStr(q) || !SCALES.has(scale as string)) fail();
  const flag = (x: unknown) => x === 0 || x === 1;
  if (!isNum(min) || !isNum(max) || !flag(signed) || !flag(zero) || !flag(na)) fail();
  if (sl !== null && !isStrRecord(sl)) fail();
  if (cats !== null && !(Array.isArray(cats) && cats.every(isStr))) fail();
  if (cl !== null && !isStrRecord(cl)) fail();
  return {
    key,
    label,
    question_wording: q,
    scale_type: scale as ScaleType,
    min,
    max,
    signed: signed === 1,
    ...(sl ? { scale_labels: sl } : {}),
    ...(cats ? { categories: cats } : {}),
    ...(cl ? { category_labels: cl } : {}),
    unselected: zero === 1 ? 'zero' : 'not_applicable',
    offer_not_applicable: na === 1,
  };
}

function fromJson(v: unknown): { payload: SurveyPayload; personal: Personal | null } {
  if (!Array.isArray(v) || v.length !== 20 || v[0] !== PAYLOAD_FORMAT) fail();
  const [
    ,
    id,
    version,
    title,
    names,
    attrLabels,
    attrValues,
    layers,
    entry,
    nq,
    required,
    intro,
    conf,
    ret,
    deadline,
    estimate,
    pub,
    fp,
    position,
    token,
  ] = v as unknown[];
  if (!isStr(id) || !isNum(version) || !isStr(title)) fail();
  if (!Array.isArray(names) || !names.every(isStr) || names.length < 2) fail();
  if (!Array.isArray(attrLabels) || !attrLabels.every(isStr)) fail();
  if (!Array.isArray(attrValues)) fail();
  if (attrLabels.length > 0 && attrValues.length !== names.length) fail();
  if (!Array.isArray(layers) || layers.length === 0) fail();
  if ((entry !== 0 && entry !== 1) || !isStr(nq) || !isStr(intro) || !isStr(conf) || !isStr(ret))
    fail();
  if (deadline !== null && !isStr(deadline)) fail();
  if (
    !Array.isArray(required) ||
    !required.every(
      (i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < names.length,
    )
  )
    fail();
  if (!isNum(estimate) || !isStr(pub) || !isStr(fp)) fail();
  const roster = names.map((name, i) => {
    const values: unknown = attrLabels.length > 0 ? attrValues[i] : [];
    if (
      !Array.isArray(values) ||
      values.length !== attrLabels.length ||
      !values.every((x) => x === null || isStr(x))
    )
      fail();
    return { name, attributes: values as (string | null)[] };
  });
  let personal: Personal | null = null;
  if (position !== null || token !== null) {
    if (!isNum(position) || !Number.isInteger(position) || position < 0 || position >= names.length)
      fail();
    if (!isStr(token) || token === '') fail();
    personal = { position, token };
  }
  return {
    payload: {
      surveyId: id,
      version,
      title,
      roster,
      attributeLabels: attrLabels,
      layers: layers.map(layerFromJson),
      entry: entry === 1 ? 'nominate' : 'full',
      nominationQuestion: nq,
      required: required as number[],
      texts: { introduction: intro, confidentiality: conf, return_instructions: ret },
      deadline: deadline,
      estimateMinutes: estimate,
      publicKey: pub,
      keyFingerprint: fp,
    },
    personal,
  };
}

async function encode(json: Json): Promise<string> {
  return toBase64Url(await deflate(utf8(JSON.stringify(json))));
}

async function decode(text: string): Promise<unknown> {
  try {
    return JSON.parse(fromUtf8(await inflate(fromBase64Url(text))));
  } catch {
    throw new PayloadError('The survey data is damaged or incomplete.');
  }
}

/** Base URL of the page (origin and path, no fragment), e.g. https://user.github.io/network/. */
export function pageBase(href: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}`;
}

export async function personalLink(base: string, p: SurveyPayload, personal: Personal) {
  return `${base}${RESPOND_PREFIX}${await encode(toJson(p, personal))}`;
}

export interface SurveyPackage {
  /** Text of the shared file. */
  text: string;
  fingerprint: string;
}

export async function makePackage(p: SurveyPayload): Promise<SurveyPackage> {
  const encoded = await encode(toJson(p, null));
  const fingerprint = toBase64Url((await sha256(utf8(encoded))).slice(0, 16));
  const text = `${JSON.stringify({ format: PACKAGE_FORMAT, v: PAYLOAD_FORMAT, survey: encoded })}\n`;
  return { text, fingerprint };
}

export function packageLink(
  base: string,
  surveyId: string,
  personal: Personal,
  fingerprint: string,
) {
  return `${base}${RESPOND_PREFIX}p/${surveyId}.${String(personal.position)}.${personal.token}.${fingerprint}`;
}

export type RespondRoute =
  | { kind: 'link'; encoded: string }
  | { kind: 'package'; surveyId: string; personal: Personal; fingerprint: string }
  | { kind: 'invalid' };

/** Reads the fragment of a respondent URL; null when it is not a respondent route. */
export function parseRespondHash(hash: string): RespondRoute | null {
  if (!hash.startsWith(RESPOND_PREFIX)) return null;
  const rest = hash.slice(RESPOND_PREFIX.length);
  if (rest.startsWith('p/')) {
    const parts = rest.slice(2).split('.');
    const [surveyId, pos, token, fingerprint] = parts;
    const position = Number(pos);
    if (
      parts.length !== 4 ||
      !surveyId ||
      !token ||
      !fingerprint ||
      !/^\d+$/.test(pos ?? '') ||
      !Number.isSafeInteger(position)
    )
      return { kind: 'invalid' };
    return { kind: 'package', surveyId, personal: { position, token }, fingerprint };
  }
  return /^[A-Za-z0-9_-]+$/.test(rest) ? { kind: 'link', encoded: rest } : { kind: 'invalid' };
}

export async function readLink(
  encoded: string,
): Promise<{ payload: SurveyPayload; personal: Personal }> {
  const { payload, personal } = fromJson(await decode(encoded));
  if (!personal) throw new PayloadError('The link has no respondent.');
  return { payload, personal };
}

export class PackageMismatchError extends Error {}

/** Reads a package file and checks it against the link's survey id, fingerprint and position. */
export async function readPackage(
  text: string,
  route: { surveyId: string; personal: Personal; fingerprint: string },
): Promise<SurveyPayload> {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new PayloadError('This is not a survey file.');
  }
  const f = file as { format?: unknown; v?: unknown; survey?: unknown };
  if (f.format !== PACKAGE_FORMAT || f.v !== PAYLOAD_FORMAT || !isStr(f.survey))
    throw new PayloadError('This is not a survey file.');
  const fingerprint = toBase64Url((await sha256(utf8(f.survey))).slice(0, 16));
  if (fingerprint !== route.fingerprint)
    throw new PackageMismatchError('The file does not match the link.');
  const { payload } = fromJson(await decode(f.survey));
  if (payload.surveyId !== route.surveyId || route.personal.position >= payload.roster.length)
    throw new PackageMismatchError('The file does not match the link.');
  return payload;
}
