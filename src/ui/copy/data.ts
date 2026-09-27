// Wording for projects, layers, matrix entry, coverage and local storage.

const count = (value: number, one: string, many: string) =>
  `${value.toLocaleString('en-GB')} ${value === 1 ? one : many}`;

export const percent = (rate: number) =>
  Number.isFinite(rate) ? `${String(Math.round(rate * 100))}%` : 'Not defined';

export const projectCopy = {
  menu: 'Project',
  open: 'Open project…',
  save: 'Save project',
  importData: 'Import data…',
  loadDemo: 'Load demo',
  keepLocal: 'Keep a copy in this browser',
  clearLocal: 'Clear local data…',
  saved: (file: string) => `Project saved as ${file}.`,
  opened: (title: string) => `Opened ${title}.`,
  demoLoaded: 'Demo loaded. Everyone in it is fictional.',
  openFailed: (file: string, reason: string) => `${file} was not opened. ${reason}`,
  noProjectToSave: 'There is no project to save. Import data or load the demo first.',
  replaceTitle: 'Replace the open project?',
  replaceBody:
    'The open project will be closed. Changes since you last saved it will be lost unless you save it first.',
  replaceConfirm: 'Replace project',
  cancel: 'Cancel',
  noMembers: 'This project has no members yet. Import a members file to add them.',
};

export const persistenceCopy = {
  indicator: 'Kept in this browser',
  indicatorSaving: 'Saving in this browser…',
  indicatorError: 'Not saved in this browser',
  turnedOn:
    'A copy of this project is now kept in this browser. It stays until you clear local data.',
  turnedOff: 'This browser no longer keeps a copy. The copy already stored was deleted.',
  unavailable: 'This browser does not allow Graticule to store data, so a copy cannot be kept.',
  saveFailed: (reason: string) => `The copy in this browser could not be updated. ${reason}`,
  restored: (title: string) => `Reopened ${title} from this browser.`,
  restoreFailed: (reason: string) => `The copy kept in this browser could not be opened. ${reason}`,
  clearTitle: 'Clear local data?',
  clearBody:
    'This deletes the project copy kept in this browser, turns off keeping a copy and resets your preferences, including the first-run notice. The project open now stays open until you close this tab; save it as a file first if you need it.',
  clearConfirm: 'Clear local data',
  cleared: 'Local data cleared.',
  clearFailed: (reason: string) => `Local data was not cleared. ${reason}`,
};

export const layerCopy = {
  heading: 'Layers',
  intro: 'Turn layers on to rate and analyse them. Edit a layer to change its label or question.',
  core: 'Core layers',
  optional: 'Optional layers',
  edit: 'Edit',
  editLabel: (label: string) => `Edit ${label}`,
  dialogTitle: 'Edit layer',
  labelField: 'Label',
  wordingField: 'Question wording',
  wordingHelp: 'Shown to participants and in the method notes.',
  scale: 'Scale',
  key: 'Import key',
  coreNote: 'Core layers can be turned off but not deleted.',
  save: 'Save layer',
  saved: (label: string) => `Layer saved: ${label}.`,
  cancel: 'Cancel',
  deleteLayer: 'Delete layer',
  deleteTitle: (label: string) => `Delete ${label}?`,
  deleteBody: (ratings: number) =>
    ratings > 0
      ? `This deletes the layer and its ${count(ratings, 'rating', 'ratings')}. You can add the layer back from the list below, but not its ratings.`
      : 'This deletes the layer. You can add it back from the list below.',
  deleted: (label: string) => `Layer deleted: ${label}.`,
  addHeading: 'Add a suggested layer',
  add: (label: string) => `Add ${label}`,
  addShort: 'Add',
  added: (label: string) => `Layer added: ${label}.`,
  emptyLabel: 'Enter a label.',
  scaleText: (min: number, max: number, signed: boolean) => {
    const sign = (v: number) => String(v).replace('-', '\u2212');
    return signed ? `${sign(min)} to +${sign(max)}, signed` : `${sign(min)} to ${sign(max)}`;
  },
  categorical: (labels: string[]) => `Categories: ${labels.join(', ')}`,
  noProject: 'Layers appear here once you import data or load the demo.',
};

export const matrixCopy = {
  layer: 'Layer',
  heading: (label: string) => `${label} matrix`,
  help: 'Each row rates the columns. Use the arrow keys to move, type a value and press Enter, press Delete to clear a cell, and paste a block copied from a spreadsheet.',
  corner: 'Rows rate columns',
  keyHeading: 'Cell key',
  keyNotRated: 'Not rated',
  keyZero: 'Rated 0',
  keyValue: 'Rated, shaded by value',
  keySelf: 'Self-pair, not recorded',
  noLayers: 'Turn on at least one layer to enter ratings.',
  noMembers: 'Import members to enter ratings.',
  gridLabel: (label: string) => `${label} ratings, raters in rows`,
  cellLabel: (rater: string, ratee: string, value: string) => `${rater} rates ${ratee}: ${value}`,
  notRated: 'not rated',
  declined: 'declined to rate',
  self: 'self-pair, not recorded',
  editValue: 'Rating',
  selfBlocked: 'Self-ratings are not recorded.',
  invalid: (text: string, min: number, max: number) =>
    `“${text}” was not entered: use a number from ${String(min)} to ${String(max)}, or clear the cell.`,
  invalidCategory: (text: string, options: string) =>
    `“${text}” was not entered: use one of ${options}.`,
  pasted: (set: number, cleared: number) =>
    `Pasted ${count(set, 'value', 'values')}` +
    (cleared > 0 ? ` and cleared ${count(cleared, 'cell', 'cells')}.` : '.'),
  pasteSkipped: (skipped: number, example: string) =>
    ` ${count(skipped, 'cell was', 'cells were')} skipped, for example ${example}.`,
  pasteOutside: (outside: number) =>
    ` ${count(outside, 'cell', 'cells')} fell outside the grid and ${outside === 1 ? 'was' : 'were'} not pasted.`,
  skipReason: {
    self: 'a self-pair',
    non_numeric: 'not a number',
    out_of_range: 'outside the scale',
    unknown_category: 'not a category',
  },
  categoryKey: 'Codes',
  position: (rater: string, ratee: string) => `${rater} rating ${ratee}`,
  scaleNote: (min: string, max: string) => `Scale ${min} to ${max}`,
};

export const coverageCopy = {
  tab: 'Coverage',
  heading: 'Data coverage',
  topBar: (rate: string) => `Coverage ${rate}`,
  overall: 'Overall response rate',
  sourcesHeading: 'Where the ratings came from',
  sources: {
    self_report: 'Survey responses',
    imported: 'Imported files',
    entered: 'Entered in the matrix',
    none: 'Not recorded',
  },
  explain:
    'The share of possible ratings that were given, across enabled layers. A rating of 0 counts as given; declined and never-entered ratings do not.',
  threshold: 'Warn below',
  thresholdHelp: 'Below this response rate, whole-network metrics may be unreliable.',
  thresholdInvalid: 'Enter a whole number from 0 to 100.',
  warning: (rate: string, threshold: string) =>
    `Coverage is ${rate}, below the ${threshold} threshold. Whole-network metrics may be unreliable. Collect the missing ratings, or lower the threshold in the Coverage panel if this is expected.`,
  columns: {
    member: 'Rater',
    rate: 'Response rate',
    rated: 'Rated',
    declined: 'Declined',
    notEntered: 'Not entered',
  },
  totals: 'All raters',
  tableCaption: 'Raters, lowest response rate first',
  below: 'Below threshold',
  noData: 'Coverage appears here once the project has members and at least one enabled layer.',
  counts: (rated: number, possible: number) =>
    `${rated.toLocaleString('en-GB')} of ${possible.toLocaleString('en-GB')} possible ratings`,
};
