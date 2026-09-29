// Wording for the in-app help (Help menu). The documents themselves are
// docs/user-guide.md, docs/method-notes.md and docs/respondent-help.md, shown
// as written.

export type HelpDoc = 'guide' | 'method' | 'respondent';

export const helpCopy = {
  title: 'Help',
  menu: {
    guide: 'User guide',
    method: 'Method notes',
    respondent: 'Help for respondents',
  } satisfies Record<HelpDoc, string>,
  tabsLabel: 'Help documents',
  contents: 'Contents',
  loading: 'Opening the document…',
  failed: 'The document could not be opened. Reload the page and try again.',
  close: 'Close',
  imageMissing: (alt: string) => `Screenshot not available: ${alt}`,
  tableLabel: 'Table',
  newWindow: '(opens in a new window)',
} as const;
