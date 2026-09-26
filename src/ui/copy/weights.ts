// Wording for the weight panel and the composite formula (spec §7).

import type { Preset, SignedTreatment } from '../state/presets';

export const weightsCopy = {
  heading: 'Weights',
  preset: 'Preset',
  presets: {
    formal: 'Formal structure',
    informal: 'Informal network',
    health: 'Relationship health',
    custom: 'Custom',
  } satisfies Record<Preset, string>,
  presetHelp: {
    formal: 'Formal collaboration, with workflow dependency.',
    informal: 'Informal collaboration, with advice and idea sharing.',
    health:
      'Connection strength, positive energy, benevolence-based trust and interpersonal safety, scaled by valence.',
    custom: 'Your own weights. Moving a slider under a preset starts from its values.',
  } satisfies Record<Preset, string>,
  share: 'Share',
  shareHelp: 'Each layer’s share of the composite. Weights are scaled to add up to 1.',
  notUsed: 'Not used',
  asFilter: 'Filter',
  asMultiplier: 'Multiplier',
  sliderText: (raw: string, share: string) => `Weight ${raw}, share of the composite ${share}`,
  treatment: (label: string) => `Use ${label} as`,
  treatments: {
    positive: 'Positive ratings, weighted',
    filterNegative: 'A filter: negative ratings remove the tie',
    multiplier: 'A multiplier on the composite',
  } satisfies Record<SignedTreatment, string>,
  noLayers: 'Turn on at least one rated layer to build a composite.',
  undefinedComposite: 'Give at least one layer a weight above 0 to build a composite.',
  updating: 'Updating…',

  formula: {
    heading: 'Composite formula',
    lead: 'Composite =',
    positiveOnly: 'positive ratings',
    multiplier: (label: string, alpha: string) => `× (1 + ${alpha} × ${label})`,
    filter: (label: string) => `set to 0 where ${label} is negative`,
    cap: (cap: string) => `capped at ${cap}`,
    note: 'Each layer is rescaled to 0–1; a signed layer runs from −1 to +1. A pair rated on only some of the layers is scored on those, with their shares scaled back up to 1.',
    notation: 'Formula in the method notes’ notation',
  },
};
