// Wording for the comparison views (spec §6 multiplexity, §8 linked views).

const num = (value: number) => value.toLocaleString('en-GB');

export const compareCopy = {
  mode: 'Compare',
  modes: { layers: 'Two layers', formalInformal: 'Formal and informal' },
  left: 'Left',
  right: 'Right',
  positive: (label: string) => `${label}, positive ties`,
  negative: (label: string) => `${label}, negative ties`,
  sameLayout:
    'Members sit where the map places them, so the two layers can be compared position for position. Click a member to show them in every view.',
  measure: 'Measure',
  ties: 'Ties',
  density: 'Density',
  reciprocity: 'Ties returned',
  components: 'Separate parts',
  communities: 'Communities',
  overlap: 'Overlap',
  both: 'Tied on both layers',
  leftOnly: (label: string) => `Only on ${label}`,
  rightOnly: (label: string) => `Only on ${label}`,
  jaccard: 'Share of ties in common',
  jaccardHelp: 'Ties on both layers as a share of ties on either (Jaccard overlap).',
  perMember: 'Ties per member',
  showPerMember: 'Show ties per member',
  hidePerMember: 'Hide ties per member',
  member: 'Member',
  shared: 'On both',
  noLayers: 'Turn on at least two rated layers to compare them.',

  fi: {
    intro:
      'Each pair of members is classified by the formal and informal collaboration layers: formal only, informal only, or both. “Formal only” means the collaboration is required but not reported as happening outside formal channels; it is a prompt for inquiry, not evidence of a problem.',
    unavailable:
      'Turn on both Formal collaboration and Informal collaboration to compare formal and informal ties.',
    formalOnly: 'Formal only',
    informalOnly: 'Informal only',
    both: 'Both',
    neither: 'Neither',
    notClassified: 'Not classified: one of the two not rated',
    class: 'Ties',
    count: 'Pairs',
    share: 'Share of tied pairs',
    caption: (directed: boolean) =>
      directed
        ? 'Formal and informal ties, directed: each rater and rated member counted separately'
        : 'Formal and informal ties, each pair of members once',
    mapLabel: (label: string, n: number) => `${label}: ${num(n)}`,
  },
};
