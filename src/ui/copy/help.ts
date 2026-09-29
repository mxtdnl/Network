// Wording for the in-app help (Help menu). The documents themselves are
// docs/user-guide.md, docs/method-notes.md, docs/respondent-help.md and the
// repository's LICENSE, shown as written.

export type HelpDoc = 'guide' | 'method' | 'respondent' | 'licence';

export const helpCopy = {
  title: 'Help',
  menu: {
    guide: 'User guide',
    method: 'Method notes',
    respondent: 'Help for respondents',
    licence: 'Licence',
  } satisfies Record<HelpDoc, string>,
  tabsLabel: 'Help documents',
  contents: 'Contents',
  loading: 'Opening the document…',
  failed: 'The document could not be opened. Reload the page and try again.',
  close: 'Close',
  imageMissing: (alt: string) => `Screenshot not available: ${alt}`,
  tableLabel: 'Table',
  newWindow: '(opens in a new window)',
  thirdParty: 'Third-party software and fonts',
  thirdPartyBody:
    'Graticule includes open-source libraries and the Fira fonts, each under its own licence. Their copyright notices and licence texts are in the third-party notices.',
  thirdPartyLink: 'Read the third-party notices',
} as const;
