// Project data model (spec §4, docs/plan.md §2). Pure types and constants: no
// React, no DOM, no engine imports.
//
// Missing ratings. A rating that was not given is `null` or absent, never 0,
// never `undefined` and never NaN (spec §4.2, CLAUDE.md D2). A tie whose value
// is `null` records that the rater declined to rate; a (rater, ratee, variable,
// wave) key with no tie at all means the rating was never entered. Both count
// as "not rated" everywhere; only the coverage view tells them apart (plan Q1).

export const SCHEMA_VERSION = 1;
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

export type AttributeType = 'categorical' | 'ordinal' | 'member_ref';

export interface AttributeDefinition {
  key: AttributeKey;
  label: string;
  type: AttributeType;
  /** Known values; ordered for ordinal attributes. */
  categories?: string[];
  builtin: boolean;
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
}

// Analysis and map state captured by a saved view (plan §1.3). Phases 5 and 6
// give these their behaviour; the file format carries them from the start.
export type LayerRef = string;
export interface AnalysisSettings {
  view: 'directed' | 'symmetrised';
  symmetrise: 'mean' | 'min' | 'max';
  activeLayer: LayerRef;
  weights: Record<LayerKey, number>;
  signedTreatment: Record<LayerKey, 'positive' | 'filterNegative' | 'multiplier'>;
  preset: 'formal' | 'informal' | 'health' | 'custom';
  nodeSizeMetric: string;
  nodeFill: { kind: 'attribute'; key: AttributeKey } | { kind: 'community' };
}

export interface AttributeFilter {
  key: AttributeKey;
  values: string[];
}

export interface MapState {
  layout: 'force' | 'grouped' | 'circular' | 'hierarchy';
  groupBy: AttributeKey | null;
  positions: Record<MemberId, { x: number; y: number; pinned: boolean }>;
  viewport: { x: number; y: number; k: number };
  threshold: number;
  layerToggles: Record<LayerKey, boolean>;
  filters: AttributeFilter[];
  egoView: { member: MemberId; depth: 1 | 2 } | null;
  path: { from: MemberId; to: MemberId } | null;
}

export interface SavedView {
  id: ViewId;
  name: string;
  caption: string;
  created_at: ISODateTime;
  analysis: AnalysisSettings;
  map: MapState;
  selection: MemberId[];
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

export interface Project {
  schema_version: typeof SCHEMA_VERSION;
  app: { name: typeof APP_NAME; version: string };
  meta: ProjectMeta;
  attribute_definitions: AttributeDefinition[];
  members: Member[];
  layers: LayerDefinition[];
  ties: Tie[];
  saved_views: SavedView[];
  settings: ProjectSettings;
}

/** Key that identifies one rating; unique within a project. */
export function tieKey(rater: MemberId, ratee: MemberId, variable: LayerKey, wave: number): string {
  return `${rater}\u0000${ratee}\u0000${variable}\u0000${String(wave)}`;
}

export function isCategorical(layer: LayerDefinition): boolean {
  return layer.scale_type === 'categorical';
}
