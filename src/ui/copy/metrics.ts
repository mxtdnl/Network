// Metric names and plain-English explanations. The "meaning" and "caveat"
// texts are taken from docs/method-notes.md §3 (the method notes are the
// source; keep the two in step). Labels follow the member panel wireframe
// (docs/design-system.md §5.2): plain names, with the technical name in the
// explanation.

import type { SizeMetric } from '../state/store';

export interface MetricCopy {
  label: string;
  technical: string;
  meaning: string;
  caveat: string;
}

const STRENGTH_MEANING =
  'How much tie weight a member receives (in-strength) or gives (out-strength). In the symmetrised view, the total weight of the member’s ties.';
const STRENGTH_CAVEAT =
  'Uses 0–1 weights, so the maximum is n − 1. Out-strength reflects how the member answered the survey as much as their relationships: generous raters have high out-strength.';
const DEGREE_MEANING = 'How many ties a member has, regardless of strength.';
const DEGREE_CAVEAT =
  'A weak tie counts as much as a strong one. In the directed view in- and out-degree are reported separately and never added.';
const HARMONIC_MEANING =
  'How easily a member can be reached from everyone else (“reachability from others”). The outgoing version measures how easily the member reaches everyone else.';
const HARMONIC_CAVEAT =
  'Unlike classic closeness, it stays defined when the network is split into separate groups: unreachable members simply add nothing.';

export const metricCopy: Record<SizeMetric, MetricCopy> = {
  inStrength: {
    label: 'Received strength',
    technical: 'In-strength',
    meaning: STRENGTH_MEANING,
    caveat: STRENGTH_CAVEAT,
  },
  outStrength: {
    label: 'Given strength',
    technical: 'Out-strength',
    meaning: STRENGTH_MEANING,
    caveat: STRENGTH_CAVEAT,
  },
  strength: {
    label: 'Strength',
    technical: 'Strength',
    meaning: STRENGTH_MEANING,
    caveat: STRENGTH_CAVEAT,
  },
  inDegree: {
    label: 'Connections in',
    technical: 'In-degree',
    meaning: DEGREE_MEANING,
    caveat: DEGREE_CAVEAT,
  },
  outDegree: {
    label: 'Connections out',
    technical: 'Out-degree',
    meaning: DEGREE_MEANING,
    caveat: DEGREE_CAVEAT,
  },
  degree: {
    label: 'Connections',
    technical: 'Degree',
    meaning: DEGREE_MEANING,
    caveat: DEGREE_CAVEAT,
  },
  betweenness: {
    label: 'Bridging',
    technical: 'Betweenness',
    meaning:
      'How often a member lies on the shortest routes between other members. High betweenness marks someone who connects parts of the network that are otherwise far apart.',
    caveat:
      'Assumes that things travel along shortest paths only. Sensitive to single ties: one extra tie can move a member’s value a great deal.',
  },
  harmonicIn: {
    label: 'Reach from others',
    technical: 'Harmonic closeness (incoming)',
    meaning: HARMONIC_MEANING,
    caveat: HARMONIC_CAVEAT,
  },
  harmonicOut: {
    label: 'Reach to others',
    technical: 'Harmonic closeness (outgoing)',
    meaning: HARMONIC_MEANING,
    caveat: HARMONIC_CAVEAT,
  },
  harmonic: {
    label: 'Reach',
    technical: 'Harmonic closeness',
    meaning: HARMONIC_MEANING,
    caveat: HARMONIC_CAVEAT,
  },
  eigenvector: {
    label: 'Ties to the well connected',
    technical: 'Eigenvector centrality',
    meaning:
      'A member is central if they are tied to members who are themselves central. It rewards being well connected to the well connected.',
    caveat:
      'Defined only on the largest group of members who can all reach each other. Values are only comparable within one group and one layer.',
  },
  constraint: {
    label: 'Constraint',
    technical: 'Burt’s constraint',
    meaning:
      'How much a member’s contacts are tied to each other. High constraint means a closed, redundant network in which the member has few independent options; low constraint means contacts in separate circles.',
    caveat:
      'Ranges from about 0 to just over 1; members with few contacts score high by construction (one contact gives constraint 1).',
  },
  effectiveSize: {
    label: 'Non-redundant contacts',
    technical: 'Effective size',
    meaning:
      'The number of a member’s contacts who are not redundant: the size of their network after discounting contacts who are tied to each other.',
    caveat: 'At most the number of contacts. Not defined for a member with no ties.',
  },
  clustering: {
    label: 'Local clustering',
    technical: 'Local clustering coefficient',
    meaning:
      'How many of a member’s contacts are tied to one another, weighted by the strength of those ties.',
    caveat:
      'A member with fewer than two contacts has clustering 0. One unusually strong tie anywhere in the layer changes every member’s value.',
  },
};

/** Metrics offered for node size and listed in the member panel, in panel order. */
export const DIRECTED_METRICS: readonly SizeMetric[] = [
  'inStrength',
  'outStrength',
  'inDegree',
  'outDegree',
  'betweenness',
  'harmonicIn',
  'harmonicOut',
  'eigenvector',
  'constraint',
  'effectiveSize',
  'clustering',
];
export const SYMMETRISED_METRICS: readonly SizeMetric[] = [
  'strength',
  'degree',
  'betweenness',
  'harmonic',
  'eigenvector',
  'constraint',
  'effectiveSize',
  'clustering',
];

export const flagCopy = {
  isolated: 'Not defined: this member has no ties on this layer.',
  outsideLargestComponent:
    'Not defined: this member is outside the largest group of members who can all reach each other.',
  noComponent: 'Not defined: no group of two or more members can all reach each other.',
  notConverged: 'Not defined: the calculation did not settle.',
  fewerThanTwoContacts: 'This member has fewer than two contacts, so the value is 0.',
  negativeSubLayer: 'Not computed on negative ties.',
} as const;
