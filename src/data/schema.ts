// Project data model (spec §4, docs/plan.md §2). Pure types and constants: no
// React, no DOM, no engine imports.
//
// Missing ratings. A rating that was not given is `null` or absent, never 0,
// never `undefined` and never NaN (spec §4.2, CLAUDE.md D2). A tie whose value
// is `null` records that the rater declined to rate; a (rater, ratee, variable,
// wave) key with no tie at all means the rating was never entered. Both count
// as "not rated" everywhere; only the coverage view tells them apart (plan Q1).
//
// A third state, "does not apply", is a `null` tie with `not_applicable: true`:
// the rater said the question has no answer for this colleague (for example
// the quality of a relationship they do not have). It is not 0 (on a signed
// layer 0 is "neutral") and it is not missing: metrics treat it as no rating,
// and coverage leaves it out of the ratings that were possible (CLAUDE.md D102).

export const SCHEMA_VERSION = 3;
export const APP_NAME = 'Graticule';
export const APP_VERSION = '0.2.0';
export const PROJECT_FILE_EXTENSION = '.ona.json';
export const DEFAULT_WAVE = 1;

export type MemberId = string;
export type LayerKey = string;
export type AttributeKey = string;
export type ViewId = string;
export type ISODateTime = string;

/** A rating as stored: a number for scaled layers, a category key for
 *  categorical layers, `null` when the rater declined to rate. */
export type RatingValue = number | string | null;

export interface Member {
  id: MemberId;
  display_name: string;
  /** `null` means the attribute was not recorded for this member. */
  attributes: Record<AttributeKey, string | null>;
}

/** `email` holds an address for survey administration only (spec §4.1): it is
 *  never analysed, shown in analysis views, or placed in a survey link. */
export type AttributeType = 'categorical' | 'ordinal' | 'member_ref' | 'email';

export interface AttributeDefinition {
  key: AttributeKey;
  label: string;
  type: AttributeType;
  /** Known values; ordered for ordinal attributes. */
  categories?: string[];
  builtin: boolean;
  /** Included in survey links and shown to respondents (spec §4.1); absent means false. */
  shareable?: boolean;
}

export type ScaleType = 'strength' | 'frequency' | 'signed' | 'categorical';

export interface LayerDefinition {
  key: LayerKey;
  label: string;
  question_wording: string;
  scale_type: ScaleType;
  /** Ignored for categorical layers. */
  min: number;
  max: number;
  signed: boolean;
  default_weight: number;
  enabled: boolean;
  /** Core layers can be disabled but not deleted (spec §4.2). */
  core: boolean;
  builtin: boolean;
  scale_labels?: Record<string, string>;
  categories?: string[];
  category_labels?: Record<string, string>;
  /** Sub-layers of one question share a group, e.g. the two conflict layers. */
  group?: string;
  /** Marks the pair used by the formal–informal comparison. */
  role?: 'formal' | 'informal';
}

export interface Tie {
  rater_id: MemberId;
  ratee_id: MemberId;
  variable: LayerKey;
  value: RatingValue;
  /** Survey wave; 1 unless stated (spec §2). */
  wave: number;
  /** The rater said the question does not apply to this colleague; `value` is then null. */
  not_applicable?: true;
  /** Where the rating came from (spec §4.2). Absent on ties saved before
   *  schema version 3: "Not recorded", never guessed. */
  source?: TieSource;
  /** The survey and version a self-reported rating answered. */
  survey?: { id: SurveyId; version: number };
}

export type TieSource = 'self_report' | 'imported' | 'entered';

// Saved views (spec §8, schema version 2). A saved view records everything
// needed to show the map again as it was: the composite weights, the map's
// encodings, filters and layout, where each member was drawn and whether it
// was pinned, and the selection. Field names inside `weights`, `map` and
// `selection` follow the app's state (ui/state/store.ts) so a view is restored
// without translation. Version 1's shape is converted by migrations.ts.
export type LayerRef = string;
export type Preset = 'formal' | 'informal' | 'health' | 'custom';
export type SignedTreatment = 'positive' | 'filterNegative' | 'multiplier';

export interface AttributeFilter {
  key: AttributeKey;
  values: string[];
}

export interface SavedWeights {
  preset: Preset;
  /** Raw slider values under Custom; layers without an entry use their default weight. */
  custom: Record<LayerKey, number>;
  customTreatment: Record<LayerKey, SignedTreatment>;
}

export interface SavedMapSettings {
  view: 'directed' | 'symmetrised';
  symmetrise: 'mean' | 'min' | 'max';
  /** The layer the map draws ties from: a layer key or 'composite'. */
  layer: LayerRef;
  /** Node-size metric (engine NodeMetricKey). */
  sizeMetric: string;
  fill: { kind: 'attribute'; key: AttributeKey } | { kind: 'community' };
  threshold: number;
  layerToggles: Record<LayerKey, boolean>;
  hideOffLayers: boolean;
  filters: AttributeFilter[];
  layout: 'force' | 'grouped' | 'circular' | 'hierarchy';
  groupBy: AttributeKey | null;
  ego: { member: MemberId; depth: 1 | 2 } | null;
  /** Members highlighted on the map; the rest are faded. */
  highlight: MemberId[];
}

export interface SavedPosition {
  x: number;
  y: number;
  pinned: boolean;
}

export interface SavedView {
  id: ViewId;
  name: string;
  /** Shown under the map in presentation mode. */
  caption: string;
  created_at: ISODateTime;
  weights: SavedWeights;
  map: SavedMapSettings;
  /** Layout coordinates by member; empty when the map had not been drawn. */
  positions: Record<MemberId, SavedPosition>;
  selection: { member: MemberId | null; group: MemberId[] };
}

export interface ProjectSettings {
  /** Share of possible ratings below which whole-network metrics are flagged. */
  coverage_threshold: number;
  anonymise: boolean;
  exclude_signed_from_exports: boolean;
  random_seed: number;
  bootstrap: { replicates: number; drop_fraction: number };
  anonymisation_scheme: 'role_team';
}

export interface ProjectMeta {
  title: string;
  created_at: ISODateTime;
  modified_at: ISODateTime;
  notes: string;
}

// Surveys (spec §4.4, §15, schema version 3). A survey's versions snapshot what
// respondents were asked; its key holds the private key only in encrypted form;
// its log records every import decision. The passphrase and the decrypted key
// are never stored.
export type SurveyId = string;
export type SurveyEntry = 'nominate' | 'full';
/** What a colleague who was not selected is stored as, per layer (CLAUDE.md D88, D102). */
export type UnselectedRule = 'zero' | 'not_applicable';

export interface SurveyLayer {
  key: LayerKey;
  label: string;
  question_wording: string;
  scale_type: ScaleType;
  min: number;
  max: number;
  signed: boolean;
  scale_labels?: Record<string, string>;
  categories?: string[];
  category_labels?: Record<string, string>;
  unselected: UnselectedRule;
  /** Respondents may answer "Does not apply" as well as a scale point (D102). */
  offer_not_applicable: boolean;
}

export interface SurveyVersion {
  version: number;
  created_at: ISODateTime;
  /** Member ids in roster order; a link names its respondent by position. */
  roster: MemberId[];
  layers: SurveyLayer[];
  entry: SurveyEntry;
  nomination_question: string;
  /** Attributes shown to respondents beside names. */
  shared_attributes: AttributeKey[];
  /** Colleagues every respondent is asked about, selected or not (D103). */
  required: MemberId[];
}

export interface SurveyTexts {
  introduction: string;
  confidentiality: string;
  return_instructions: string;
}

export interface SurveySettings {
  burden_limit_minutes: number;
  expected_nominations: number;
  /** 'auto' issues links within the length budget and packages beyond it. */
  link_mode: 'auto' | 'package';
}

/** Base64url fields: the private key encrypted under a passphrase-derived key. */
export interface WrappedKey {
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface SurveyKey {
  /** Uncompressed P-256 point, base64url. */
  public_key: string;
  fingerprint: string;
  wrapped: WrappedKey;
}

export interface SurveyRespondent {
  member_id: MemberId;
  token: string;
  /** The latest version this member was issued a link for. */
  version: number;
  issued_at: ISODateTime;
}

export type RejectReason =
  | 'unreadable'
  | 'other_survey'
  | 'other_key'
  | 'tampered'
  | 'unknown_version'
  | 'unknown_token'
  | 'token_mismatch'
  | 'already_imported'
  | 'closed';

export type SurveyLogEntry =
  | {
      kind: 'accepted';
      receipt: string;
      member_id: MemberId;
      version: number;
      submitted_at: ISODateTime;
      imported_at: ISODateTime;
      ratings: number;
      /** Receipt of a later submission that replaced this one. */
      replaced_by: string | null;
    }
  | {
      kind: 'duplicate';
      member_id: MemberId;
      kept: string;
      set_aside: string;
      imported_at: ISODateTime;
    }
  | {
      kind: 'rejected';
      /** File name, or "Pasted text n". */
      source: string;
      receipt: string | null;
      reason: RejectReason;
      imported_at: ISODateTime;
    };

export interface Survey {
  id: SurveyId;
  title: string;
  created_at: ISODateTime;
  status: 'open' | 'closed';
  wave: number;
  texts: SurveyTexts;
  /** YYYY-MM-DD, or null. */
  deadline: string | null;
  settings: SurveySettings;
  key: SurveyKey;
  versions: SurveyVersion[];
  respondents: SurveyRespondent[];
  log: SurveyLogEntry[];
}

export interface Project {
  schema_version: typeof SCHEMA_VERSION;
  app: { name: typeof APP_NAME; version: string };
  meta: ProjectMeta;
  attribute_definitions: AttributeDefinition[];
  members: Member[];
  layers: LayerDefinition[];
  ties: Tie[];
  saved_views: SavedView[];
  surveys: Survey[];
  settings: ProjectSettings;
}

/** Key that identifies one rating; unique within a project. */
export function tieKey(rater: MemberId, ratee: MemberId, variable: LayerKey, wave: number): string {
  return `${rater}\u0000${ratee}\u0000${variable}\u0000${String(wave)}`;
}

export function isCategorical(layer: LayerDefinition): boolean {
  return layer.scale_type === 'categorical';
}
