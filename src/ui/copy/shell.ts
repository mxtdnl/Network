// User-facing strings for the app shell. Sentence case, plain language (spec §12).

export const shellCopy = {
  appName: 'Graticule',
  noProject: 'No project open',
  hideNames: 'Hide names',
  present: 'Present',
  help: 'Help',
  loadingSurvey: 'Loading the survey tools…',
  helpMenu: {
    notice: 'Data and consent notice',
  },
  regions: {
    left: 'Layers and filters',
    centre: 'Views',
    right: 'Member, insights and coverage',
  },
  left: {
    heading: 'Layers',
    map: 'Map',
  },
  centreTabs: {
    map: 'Map',
    matrix: 'Matrix',
    table: 'Table',
    compare: 'Compare',
    survey: 'Survey',
  },
  rightTabs: {
    member: 'Member',
    insights: 'Insights',
    coverage: 'Coverage',
  },
  empty: {
    heading: 'Run a survey, import data or load the demo',
    body: 'Run a survey: each person answers through their own link and returns an encrypted response to you. Or import survey data you already hold, as a members file and a ties file in CSV or XLSX format, or explore Graticule with a fictional team of 40 people.',
    phoneBody:
      'On a phone, open a project saved on this device from the Project menu, or explore Graticule with a fictional team of 40 people. Surveys and imports need a tablet or computer.',
    privacy: 'Files are processed in this browser and are not uploaded anywhere.',
    runSurvey: 'Run a survey',
    importData: 'Import survey data',
    loadDemo: 'Load demo',
  },
  centreEmpty: {
    matrix: 'The adjacency matrix appears here once you add data.',
    table: 'The metrics table appears here once you add data.',
    compare: 'The side-by-side layer comparison appears here once you add data.',
  },
  phone: {
    readOnly:
      'On a phone the project can be viewed and explored, not changed. Import data, enter ratings, edit layers and views, and run surveys on a tablet or computer.',
    controls: 'Weights and map settings',
  },
  rightEmpty: {
    member: 'Add data, then select a member on the map to see their position in the network.',
    insights:
      'Insights appear here once you add data. Each one is a question for inquiry, shown with the rule that produced it.',
  },
} as const;
