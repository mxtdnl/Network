// Builds the engine's AnalysisInput from a project (plan §1.2). This is the only
// place a missing rating (`null` or an absent tie) becomes NaN (CLAUDE.md D2);
// a rating of 0 stays 0. Wave 1 only; categorical layers are not analysed.
// Coverage needs the declined / not-entered distinction, which NaN loses, so
// it is computed here from the project (src/data/coverage.ts, D29).

import { computeCoverage } from '../data/coverage';
import { DEFAULT_WAVE, isCategorical, type AnalysisSettings, type Project } from '../data/schema';
import type { AnalysisInput, AttributeColumn, EngineLayer, EngineSettings } from './types';

export type AnalysisOptions = Pick<
  AnalysisSettings,
  'view' | 'symmetrise' | 'weights' | 'signedTreatment'
>;

export function engineSettings(project: Project, options: AnalysisOptions): EngineSettings {
  return {
    view: options.view,
    symmetrise: options.symmetrise,
    weights: { ...options.weights },
    signedTreatment: { ...options.signedTreatment },
    seed: project.settings.random_seed,
  };
}

export function buildAnalysisInput(
  project: Project,
  options: AnalysisOptions,
  inputKey: string,
): AnalysisInput {
  const memberIds = project.members.map((m) => m.id);
  const n = memberIds.length;
  const index = new Map(memberIds.map((id, i) => [id, i]));

  const defs = project.layers.filter((l) => l.enabled && !isCategorical(l));
  const layers: EngineLayer[] = defs.map((l) => ({
    key: l.key,
    label: l.label,
    min: l.min,
    max: l.max,
    signed: l.signed,
    ...(l.role === undefined ? {} : { role: l.role }),
    defaultWeight: l.default_weight,
  }));
  const layerIndex = new Map(defs.map((l, k) => [l.key, k]));
  const ratings = defs.map(() => new Float64Array(n * n).fill(NaN));

  for (const t of project.ties) {
    if (t.wave !== DEFAULT_WAVE || typeof t.value !== 'number') continue;
    const k = layerIndex.get(t.variable);
    const i = index.get(t.rater_id);
    const j = index.get(t.ratee_id);
    if (k === undefined || i === undefined || j === undefined || i === j) continue;
    (ratings[k] as Float64Array)[i * n + j] = t.value;
  }

  const attributes: Record<string, AttributeColumn> = {};
  for (const a of project.attribute_definitions) {
    if (a.type === 'member_ref') continue;
    attributes[a.key] = {
      categories: [...(a.categories ?? [])],
      values: project.members.map((m) => m.attributes[a.key] ?? null),
    };
  }

  return {
    inputKey,
    memberIds,
    attributes,
    layers,
    ratings,
    settings: engineSettings(project, options),
    coverage: computeCoverage(project),
  };
}
