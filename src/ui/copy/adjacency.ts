// Wording for the adjacency matrix (spec §8).

export const adjacencyCopy = {
  modeLabel: 'Matrix',
  modes: { explore: 'Tie strength', enter: 'Enter ratings' },
  layer: 'Ties from',
  sort: 'Order by',
  byName: 'Name',
  attributes: 'Attribute',
  community: 'Community',
  metrics: 'Metric, highest first',
  key: 'Matrix key',
  notRated: 'Not rated',
  zero: 'No tie (0)',
  ramp: 'Weaker to stronger, 0 to 1',
  directed: 'Rows give, columns receive',
  symmetrised: 'Each pair once, both directions combined',
  help: 'Arrow keys move between cells. Enter shows the row’s member in every view; Shift and Enter adds them to the subgroup or takes them out.',
  noMembers: 'No members match the filters. Remove a filter to show members again.',
  gridLabel: (layer: string) => `Tie strength between members, from ${layer}`,
  corner: (directed: boolean) => (directed ? 'Rater, rated' : 'Member'),
  self: (name: string) => `${name}: the same member`,
  selfShort: 'Same member',
  noTie: 'No tie',
  inGroup: ', in the subgroup',
  readout: (a: string, b: string, value: string, directed: boolean) =>
    directed ? `${a} to ${b}: ${value}` : `${a} and ${b}: ${value}`,
};
