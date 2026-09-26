// User-facing strings for the app shell. Sentence case, plain language (spec §12).

export const shellCopy = {
  appName: 'Graticule',
  noProject: 'No project open',
  hideNames: 'Hide names',
  present: 'Present',
  help: 'Help',
  helpMenu: {
    notice: 'Data and consent notice',
  },
  regions: {
    left: 'Layers and filters',
    centre: 'Views',
    right: 'Member and insights',
  },
  left: {
    heading: 'Layers',
    empty: 'Layer weights and filters appear here once you add data.',
  },
  centreTabs: {
    map: 'Map',
    matrix: 'Matrix',
    table: 'Table',
    compare: 'Compare',
  },
  rightTabs: {
    member: 'Member',
    insights: 'Insights',
  },
  empty: {
    heading: 'Import data or load the demo',
    body: 'Import a members file and a ties file in CSV or XLSX format, or explore Graticule with a fictional team of 40 people.',
    privacy: 'Files are processed in this browser and are not uploaded anywhere.',
    importData: 'Import data',
    loadDemo: 'Load demo',
    unavailable: 'Import and the demo are not available in this preview build yet.',
  },
  centreEmpty: {
    matrix: 'The adjacency matrix appears here once you add data.',
    table: 'The metrics table appears here once you add data.',
    compare: 'The side-by-side layer comparison appears here once you add data.',
  },
  rightEmpty: {
    member: 'Add data, then select a member on the map to see their position in the network.',
    insights:
      'Insights appear here once you add data. Each one is a question for inquiry, shown with the rule that produced it.',
  },
} as const;
