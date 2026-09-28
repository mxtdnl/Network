// Wording for the map, its controls, legend and member panel (spec §8).
// Sentence case, plain language; technical names live in the method notes.

// Number formatters are cached: building one per call (toLocaleString with
// options) cost ~90 ms per redraw of the 250-member map's accessible names.
const plain = new Intl.NumberFormat('en-GB');
const formatters = new Map<number, Intl.NumberFormat>();
function fixed(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(digits, f);
  }
  return f;
}

const num = (value: number) => plain.format(value);
const count = (value: number, one: string, many: string) =>
  `${num(value)} ${value === 1 ? one : many}`;

/** Two significant decimals for weights and metric values, tabular in the UI. */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return 'Not defined';
  if (Number.isInteger(value)) return num(value);
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return fixed(digits).format(value);
}

/** Values on one scale share their number of decimals, e.g. 0, 0.218, 0.437 → 0.000, 0.218, 0.437. */
export function formatScale(values: readonly number[]): string[] {
  const finite = values.filter(Number.isFinite);
  const max = Math.max(0, ...finite.map(Math.abs));
  const allIntegers = finite.every(Number.isInteger);
  const digits = allIntegers ? 0 : max >= 100 ? 0 : max >= 10 ? 1 : max >= 1 ? 2 : 3;
  return values.map((v) => (Number.isFinite(v) ? fixed(digits).format(v) : 'Not defined'));
}

/** A 0–1 weight, always with two decimals. */
export const formatWeight = (w: number) =>
  w.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const mapCopy = {
  heading: 'Map',
  region: 'Network map',
  calculating: 'Calculating the network…',
  failed: (reason: string) => `The network could not be calculated. ${reason}`,
  noTies:
    'No ties are shown. Lower the tie strength threshold, clear a filter or choose another layer.',
  noMembers: 'No members match the filters. Remove a filter to show members again.',
  coverage: (rate: string, threshold: string) =>
    `Data coverage is ${rate}, below the ${threshold} threshold. Whole-network metrics may be unreliable.`,

  controls: {
    layer: 'Ties from',
    layerHelp: 'Sets layout attraction, edge width, node size and ranks.',
    composite: 'Composite of all layers',
    show: 'Show on the map',
    onMap: 'on the map',
    whenOff: 'When a layer is switched off',
    keepTies: 'Keep its ties',
    hideTies: 'Hide its ties',
    styleHelp: 'Formal and informal together set the line style.',
    colourHelp: 'Valence sets the edge colour.',
    direction: 'Direction',
    directed: 'Directed',
    symmetrised: 'Mutual',
    combine: 'Combine the two directions by',
    mean: 'Average',
    min: 'Weaker of the two',
    max: 'Stronger of the two',
    threshold: 'Tie strength at least',
    size: 'Node size',
    fill: 'Node fill',
    community: 'Community',
    filter: 'Filter',
    filterAttribute: 'Attribute',
    filterValue: 'Value',
    addFilter: 'Add filter',
    removeFilter: (label: string) => `Remove filter ${label}`,
    filterChip: (attribute: string, value: string) => `${attribute}: ${value}`,
    search: 'Search',
    searchHelp: 'Type part of a name.',
    matches: (n: number) =>
      n === 0 ? 'No members match.' : `${count(n, 'member matches', 'members match')}.`,
    notRecorded: 'Not recorded',
  },

  modes: {
    ego: (name: string, depth: 1 | 2) =>
      `Ego view: ${name} and members within ${depth === 1 ? 'one step' : 'two steps'}.`,
    exitEgo: 'Show everyone',
    path: (from: string, to: string) => `Shortest path from ${from} to ${to}.`,
    noPath: 'No path connects the two members on this layer.',
    clearPath: 'Clear path',
    removed: (n: number) =>
      `Simulating the removal of ${count(n, 'member', 'members')}; they are hidden.`,
    removedShown: (n: number) =>
      `Simulating the removal of ${count(n, 'member', 'members')}; they are shown.`,
    showRemoved: 'Show them',
    hideRemoved: 'Hide them',
    endSimulation: 'End simulation',
  },

  tools: {
    group: 'Selection tools',
    lasso: 'Lasso select',
    clearGroup: (n: number) => `Clear subgroup (${num(n)})`,
  },

  layouts: {
    label: 'Layout',
    force: 'Force-directed',
    grouped: 'Grouped',
    circular: 'Circular',
    hierarchy: 'Formal hierarchy',
    groupBy: 'Group by',
    hierarchyHelp:
      'Members placed by reporting line, with informal collaboration ties drawn over it.',
    hierarchyUnavailable:
      'Formal hierarchy needs formal manager ids. Add a manager_id column to the members file and import it again.',
    groupedHelp: 'Members pulled together by group; ties inside a group still attract.',
    circularHelp: 'Members on a circle, one arc per group.',
    forceHelp: 'Ties pull members together in proportion to their strength.',
  },

  zoom: {
    group: 'Map view',
    in: 'Zoom in',
    out: 'Zoom out',
    fit: 'Fit to view',
    unpin: 'Release pinned members',
  },

  legend: {
    heading: 'Legend',
    size: 'Node size',
    low: 'Low',
    high: 'High',
    notDefined: 'Not defined',
    fill: 'Node fill',
    other: (groups: number) => `Other (${count(groups, 'group', 'groups')})`,
    notRecorded: 'Not recorded',
    noCommunity: 'No community',
    communityOf: (layer: string) => `Community, detected on ${layer}`,
    community: (i: number) => `Community ${num(i)}`,
    width: 'Edge width',
    widthScale: (layer: string) => layer,
    threshold: (value: string) => `Ties below ${value} hidden`,
    hiddenLayers: (labels: string[]) => `Ties on ${labels.join(' and ')} hidden`,
    colour: 'Edge colour',
    valence: 'Valence, −3 to +3',
    valenceNotRated: 'Valence not rated',
    colourOff: 'Not used: valence is hidden',
    colourNone: 'Not used',
    style: 'Edge style',
    styleVariable: 'Formal and informal collaboration',
    formal: 'Formal only',
    informal: 'Informal only',
    both: 'Formal and informal',
    neither: 'Neither, or not rated',
    arrows: 'Arrowheads',
    arrowsText: 'Point from rater to rated member',
    position: 'Position',
    groupedBy: (attribute: string) => `Grouped by ${attribute}`,
    circleBy: (attribute: string) => `On a circle by ${attribute}`,
    hierarchy: 'Formal hierarchy',
    reportingLines: 'Reporting line, manager above',
    marks: 'Marks',
    highlighted: (n: number) =>
      n === 1
        ? 'Highlighted member; others faded'
        : `Highlighted members (${num(n)}); others faded`,
    selected: 'Selected member',
    group: (n: number) => `Subgroup (${count(n, 'member', 'members')})`,
    path: 'Shortest path',
  },

  nodes: {
    group: 'Members on the map',
    instructions:
      'Arrow keys move to the nearest connected member in that direction. Enter opens the member panel; Escape closes it. Shift and Enter adds the member to the subgroup or takes them out. Plus and minus zoom; 0 fits the map to view.',
    label: (name: string, group: string, ties: number) =>
      `${name}, ${group}, ${count(ties, 'tie shown', 'ties shown')}`,
    inGroup: ', in the subgroup',
  },

  table: {
    caption: (layer: string) => `Members and ties shown on the map, from ${layer}`,
    member: 'Member',
    group: 'Node fill group',
    size: 'Node size metric',
    ties: 'Ties shown',
    connected: 'Connected to',
  },

  panel: {
    empty:
      'Select a member on the map, or focus the map and press Enter, to see their position in the network.',
    close: 'Close member panel',
    position: 'Position in the network',
    composite: 'Composite',
    value: 'Value',
    rank: 'Rank',
    rankNote: (n: number) =>
      `Rank 1 is the highest value of ${num(n)} members; a range means tied values. Rank ranges from resampling are calculated on request in the metrics table.`,
    rankIntervalNote: (metric: string, replicates: number) =>
      `The rank of ${metric} is the range from resampling (95 %, ${num(replicates)} resamples); other ranks are single ranks, and a range there means tied values.`,
    showEgo: 'Show ego view',
    joinGroup: 'Add to subgroup',
    leaveGroup: 'Take out of subgroup',
    simulateRemoval: 'Simulate removal',
    about: (label: string) => `About ${label}`,
    technical: (name: string) => `Technical name: ${name}.`,
    ties: 'Ties by layer',
    given: 'Given',
    received: 'Received',
    notRated: '–',
    notApplicable: 'n/a',
    notRatedNote:
      '– means not rated, which is different from 0; n/a means the rater said the question does not apply.',
    noTies: 'No ratings either way on this layer.',
    manager: 'Manager',
    selectManager: (name: string) => `Show ${name}`,
  },
};
