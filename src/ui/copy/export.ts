// Wording for exports (spec §11): the export dialog, the CSV headers, the map
// export and the PDF report. Sentence case; a button's verb and its
// confirmation match ("Export map" → "Map exported", spec §12).

const num = (value: number) => value.toLocaleString('en-GB');
const count = (value: number, one: string, many: string) =>
  `${num(value)} ${value === 1 ? one : many}`;

export const exportCopy = {
  menu: 'Export',
  dialogTitle: 'Export',
  intro:
    'Exports are saved as files on this device. They follow the two settings below, which apply to every export.',
  close: 'Close',

  settings: {
    heading: 'What exports contain',
    hideNames: 'Hide names',
    hideNamesHelp:
      'Members appear as team, level and number codes. The same switch as in the top bar.',
    excludeSigned: 'Leave out valence, energy and conflict',
    excludeSignedHelp:
      'These layers hold negative ratings of named colleagues. When left out, exports are calculated again without them, so no figure depends on them. Saved with the project.',
    excludeSignedNone: 'This project has no valence, energy or conflict layer enabled.',
  },

  map: {
    heading: 'Map',
    help: 'The map as it is on screen, with its legend and an optional caption.',
    notReady: 'The map appears once the analysis has run.',
    format: 'Format',
    png: 'PNG image',
    svg: 'SVG drawing',
    resolution: 'Resolution',
    x1: 'Screen (1×)',
    x2: 'High (2×)',
    print: 'Print (300 dpi)',
    printHelp: 'Wide enough to print across an A4 landscape page at 300 dots per inch.',
    svgHelp: 'Vector drawing with the fonts embedded, for print and further editing.',
    caption: 'Caption (optional)',
    captionHelp: 'Printed under the map. Names in it are replaced by codes when names are hidden.',
    export: 'Export map',
    exported: (file: string) => `Map exported as ${file}.`,
    failed: (reason: string) => `The map could not be exported. ${reason}`,
  },

  tables: {
    heading: 'Tables',
    help: 'CSV files with unrounded values; an empty cell means not defined or not rated.',
    members: 'Export member metrics',
    membersHelp:
      'Every member’s position on every layer and the composite, one row per member and layer.',
    network: 'Export network metrics',
    networkHelp: 'Density, reciprocity, groups, communities and mixing between teams, per layer.',
    formalInformal: 'Export formal and informal ties',
    formalInformalHelp: 'Every pair classified as formal only, informal only, both or neither.',
    formalInformalUnavailable:
      'Needs both the formal and the informal collaboration layers. Enable them in the layer list.',
    exported: (file: string) => `Table exported as ${file}.`,
    failed: (reason: string) => `The table could not be exported. ${reason}`,
  },

  report: {
    heading: 'Report',
    help: 'A PDF summary: the map with the caption above, key network metrics, insights, method notes, data coverage with survey response rates, and an ethics statement.',
    export: 'Export report',
    exporting: 'Preparing the report…',
    exported: (file: string) => `Report exported as ${file}.`,
    failed: (reason: string) => `The report could not be exported. ${reason}`,
  },

  busy: 'Preparing the export…',
  noAnalysis: 'Exports are available once the project has members and the analysis has run.',
  reanalysing: 'Calculating without the left-out layers…',

  // ------------------------------------------------------------- CSV columns
  csv: {
    member: 'Member',
    memberId: 'Member id',
    layer: 'Ties from',
    community: 'Community',
    notDefinedReason: 'Not defined because',
    receivedRatings: 'Ratings received (−1 to +1 scale)',
    raters: 'Members giving them',
    measure: 'Measure',
    attribute: 'Attribute',
    group: 'Group',
    otherGroup: 'Other group',
    value: 'Value',
    from: 'From',
    to: 'To',
    memberA: 'Member',
    memberB: 'Other member',
    teamOf: (label: string) => `${label}, first member`,
    teamOfOther: (label: string) => `${label}, other member`,
    classification: 'Classification',
    classes: {
      formalOnly: 'Formal only',
      informalOnly: 'Informal only',
      both: 'Formal and informal',
      neither: 'Neither',
      notClassified: 'Not classified (a rating is missing)',
    },
    betweennessBinary: 'Bridging, every tie counted as 1 (binary betweenness)',
    positive: (label: string) => `${label}, positive ratings`,
    negative: (label: string) => `${label}, negative ratings`,
    view: 'Direction',
    directed: 'Directed',
    symmetrised: (rule: string) => `Mutual, combined by ${rule}`,
    rules: { mean: 'average', min: 'the weaker of the two', max: 'the stronger of the two' },
    measures: {
      view: 'Direction of ties',
      members: 'Members',
      ties: 'Ties',
      density: 'Density',
      tieReciprocity: 'Ties returned (tie reciprocity)',
      dyadReciprocity: 'Pairs with ties both ways (dyad reciprocity)',
      mutualPairs: 'Pairs tied both ways',
      oneWayPairs: 'Pairs tied one way',
      averageClustering: 'Average clustering',
      weakComponents: 'Separate parts (weakly connected components)',
      largestWeak: 'Members in the largest part (weak)',
      strongComponents: 'Groups that can all reach each other (strongly connected components)',
      largestStrong: 'Members in the largest such group (strong)',
      components: 'Separate parts (connected components)',
      largestComponent: 'Members in the largest part',
      centralisationIn: 'Centralisation of connections in',
      centralisationOut: 'Centralisation of connections out',
      centralisationDegree: 'Centralisation of connections',
      centralisationBetweenness: 'Centralisation of bridging',
      communities: 'Communities (Louvain)',
      modularity: 'Modularity',
      ei: 'E-I index',
      eiExcluded: 'Members without a value, left out of the E-I index',
      groupSize: 'Group size',
      internalTies: 'Ties inside the group',
      externalTies: 'Ties leaving the group',
      crossDensity: 'Tie density between groups',
      balanced: 'Balanced trios',
      unbalanced: 'Unbalanced trios',
      balanceRatio: 'Balance ratio',
      triad: (pattern: string) => `Trios with signs ${pattern}`,
      overlap: (other: string) => `Ties shared with ${other} (Jaccard)`,
      formalOnly: 'Pairs with formal ties only',
      informalOnly: 'Pairs with informal ties only',
      both: 'Pairs with formal and informal ties',
      neither: 'Pairs with neither',
      notClassified: 'Pairs not classified (a rating is missing)',
      formula: 'Composite formula',
      coverage: 'Data coverage',
      coverageThreshold: 'Data coverage warning threshold',
    },
    formalInformalLayer: 'Formal and informal collaboration',
  },

  // ----------------------------------------------------------------- files
  files: {
    map: (view: string, ext: string) => `graticule-map-${view}.${ext}`,
    members: (view: string) => `graticule-member-metrics-${view}.csv`,
    network: (view: string) => `graticule-network-metrics-${view}.csv`,
    formalInformal: (view: string) => `graticule-formal-informal-${view}.csv`,
    report: (date: string) => `graticule-report-${date}.pdf`,
  },
  /** File-name suffix naming the export's settings, so files made under different settings differ. */
  suffix: (anonymised: boolean, excluded: boolean) =>
    `${anonymised ? '-codes' : ''}${excluded ? '-no-signed' : ''}`,
};

// ------------------------------------------------------------------ report
export const reportCopy = {
  documentTitle: (project: string) => `${project}: network summary`,
  mapTitle: (project: string) => `${project}: network map`,
  subject: 'Organisational network analysis summary report',
  creator: 'Graticule',
  cover: {
    subtitle: 'Network summary report',
    date: (date: string) => `Prepared on ${date}`,
    members: (n: number, layers: number) =>
      `${count(n, 'member', 'members')}, ${count(layers, 'relationship layer', 'relationship layers')} analysed.`,
    view: (text: string) => `Ties are read ${text}.`,
    directed: 'in the direction they were rated (directed view)',
    symmetrised: (rule: string) => `as mutual pairs, combining the two directions by ${rule}`,
    weights: (preset: string) => `Composite weights: ${preset}.`,
    presets: {
      formal: 'the Formal structure preset',
      informal: 'the Informal network preset',
      health: 'the Relationship health preset',
      custom: 'set by the analyst',
    },
    anonymised:
      'Names are hidden: members appear as team, level and number codes, and names in free text are replaced.',
    named: 'Members are named. Handle this report as personal data.',
    excluded:
      'Signed layers (rated from negative to positive) and conflict layers are left out: every figure in this report was calculated without them.',
    excludedNone:
      'The signed-layer exclusion is on; this project has none of those layers enabled.',
    descriptive:
      'This report describes the structure of working relationships. It is not an assessment of anyone, and should not be used to evaluate individual performance.',
    contents: 'Contents',
    generated: (version: string) => `Generated in the browser by Graticule ${version}.`,
  },
  sections: {
    map: 'Network map',
    metrics: 'Key network metrics',
    insights: 'Insights',
    method: 'Method notes',
    coverage: 'Data coverage',
    ethics: 'Ethics statement',
  },
  map: {
    intro: (layer: string) => `Ties drawn from ${layer}. The legend explains every encoding.`,
  },
  metrics: {
    intro:
      'Whole-network measures for the composite and each layer. Definitions and caveats are in the method notes.',
    measure: 'Measure',
    formula: 'Composite as calculated',
    mixing: (attribute: string, layer: string) =>
      `Ties within and between groups by ${attribute}, on ${layer}`,
    group: 'Group',
    size: 'Members',
    internal: 'Inside',
    external: 'Leaving',
    ei: 'E-I index',
    mixingNote:
      'E-I runs from −1 (every tie stays inside the group) to +1 (every tie leaves it). Larger groups have more chances of internal ties.',
    signed: (layer: string) => `Structural balance: ${layer}`,
    allGroups: 'All groups',
    formalInformal: 'Formal and informal collaboration, pairs',
    notDefined: 'Not defined',
    none: 'No layer has ties to measure.',
  },
  insights: {
    intro:
      'Rule-based observations from this analysis. Each is a question to explore with the people involved, not a finding about anyone.',
    members: 'Members',
    view: 'Shown with',
    leftOut:
      'Negative clusters are not listed: the rule reads signed layers, which are left out of this report.',
  },
  method: {
    intro:
      'Drawn from Graticule’s method notes, which give every formula in full. Only the measures used in this report are included.',
    meaning: 'Meaning',
    caveats: 'Caveats',
  },
  coverage: {
    overall: 'Overall response rate',
    counts: (rated: number, possible: number) =>
      `${num(rated)} of ${num(possible)} possible ratings were given.`,
    breakdown: 'Ratings',
    given: 'Given',
    declined: 'Declined',
    notEntered: 'Not entered',
    notApplicable: 'Does not apply',
    possible: 'Possible',
    threshold: (t: string) => `Warning threshold: ${t}.`,
    warning: (rate: string, threshold: string) =>
      `Coverage is ${rate}, below the ${threshold} threshold. Whole-network metrics may be unreliable: missing ratings look like missing ties.`,
    fine: (rate: string, threshold: string) =>
      `Coverage is ${rate}, at or above the ${threshold} threshold.`,
    lowRaters: (n: number, threshold: string) =>
      n === 0
        ? `No rater is below ${threshold}.`
        : `${count(n, 'rater is', 'raters are')} below ${threshold}:`,
    rater: 'Rater',
    rate: 'Response rate',
    sources: 'Where the ratings came from',
    source: 'Source',
    surveys: 'Survey response rates',
    survey: 'Survey',
    status: 'Status',
    open: 'Open',
    closed: 'Closed',
    issued: 'Links issued',
    responded: 'Responses',
    rate2: 'Response rate',
    noSurveys: 'No survey was run in Graticule for this project; ratings were imported or entered.',
  },
  ethics: {
    paragraphs: [
      'This report maps working relationships between named people. It describes the structure of a network; it does not measure anyone’s performance, and it should not be used in performance evaluation or in decisions about individuals.',
      'Participants should have given informed consent, and should have been told what would be collected, who would see the results and how the results would be used. Survey responses are confidential, not anonymous: the analyst sees who gave which ratings.',
      'Processing named employee data is likely to engage data protection law. Store, share and delete this report as personal data, following the advice your organisation has taken.',
      'Every position in a network has many causes, including role, tenure, location, workload and the survey itself. Observations here are prompts for conversation with the people involved, not conclusions about them.',
    ],
    anonymised:
      'Names in this report are replaced by team, level and number codes. Codes of small teams can still identify someone, so treat the report as personal data.',
    excluded:
      'Ratings on signed layers and on conflict layers are left out of this report and of every figure in it.',
  },
  pageOf: (page: number, pages: number) => `${num(page)} of ${num(pages)}`,
};
