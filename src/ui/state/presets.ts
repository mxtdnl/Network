// Composite weighting presets (spec §7) and the weights the engine receives.
// A preset names raw slider values for the layers it uses; every other
// enabled layer gets 0 and is left out of the composite. The engine
// normalises the weights of the summed layers to 1 (docs/method-notes.md §6),
// so only the proportions matter. Under Custom the analyst's own slider
// values apply, and a layer without one uses its default weight.

import { isCategorical, type LayerKey, type Project } from '../../data/schema';

export type Preset = 'formal' | 'informal' | 'health' | 'custom';
export type SignedTreatment = 'positive' | 'filterNegative' | 'multiplier';

export const PRESETS: readonly Preset[] = ['formal', 'informal', 'health', 'custom'];

interface PresetDefinition {
  weights: Record<LayerKey, number>;
  treatment: Record<LayerKey, SignedTreatment>;
}

// One rule for every preset: the defining layer has twice the raw weight of
// each supporting layer. Relationship health uses valence as a multiplier, so
// negative ratings lower the composite rather than being ignored; its weight
// only switches it on.
export const PRESET_DEFINITIONS: Record<Exclude<Preset, 'custom'>, PresetDefinition> = {
  // Ties required by role, process or reporting line.
  formal: {
    weights: { formal_collaboration: 0.4, workflow_dependency: 0.2 },
    treatment: {},
  },
  // Collaboration and help that happen outside formal channels.
  informal: {
    weights: { informal_collaboration: 0.4, advice: 0.2, idea_sharing: 0.2 },
    treatment: {},
  },
  // The quality of relationships: valence scales the composite, which sums
  // connection strength, positive energy and, where collected, trust and safety.
  health: {
    weights: {
      valence: 0.4,
      connection_strength: 0.2,
      benevolence_trust: 0.2,
      interpersonal_safety: 0.2,
      energy: 0.2,
    },
    treatment: { valence: 'multiplier', energy: 'positive' },
  },
};

export interface WeightState {
  preset: Preset;
  /** Raw slider values under Custom; layers without an entry use their default weight. */
  custom: Record<LayerKey, number>;
  customTreatment: Record<LayerKey, SignedTreatment>;
}

export function initialWeightState(): WeightState {
  return { preset: 'custom', custom: {}, customTreatment: {} };
}

/** Enabled layers that take part in the composite (the engine's layers). */
export function weightedLayers(project: Project) {
  return project.layers.filter((l) => l.enabled && !isCategorical(l));
}

/** Raw weights and signed treatments for every weighted layer, as sent to the engine. */
export function effectiveWeights(
  project: Project,
  state: WeightState,
): { weights: Record<LayerKey, number>; signedTreatment: Record<LayerKey, SignedTreatment> } {
  const weights: Record<LayerKey, number> = {};
  const signedTreatment: Record<LayerKey, SignedTreatment> = {};
  const preset = state.preset === 'custom' ? null : PRESET_DEFINITIONS[state.preset];
  for (const layer of weightedLayers(project)) {
    weights[layer.key] = preset
      ? (preset.weights[layer.key] ?? 0)
      : (state.custom[layer.key] ?? layer.default_weight);
    if (layer.signed) {
      signedTreatment[layer.key] =
        (preset ? preset.treatment[layer.key] : state.customTreatment[layer.key]) ?? 'positive';
    }
  }
  return { weights, signedTreatment };
}

/** A stable text form of the weights, part of the analysis input key. */
export function weightsKey(w: ReturnType<typeof effectiveWeights>): string {
  const keys = Object.keys(w.weights).sort();
  return keys
    .map(
      (k) =>
        `${k}=${String(w.weights[k])}${w.signedTreatment[k] ? `/${w.signedTreatment[k]}` : ''}`,
    )
    .join(',');
}
