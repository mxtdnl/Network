// First-run ethics and data protection notice (spec §10).
// Keep claims precise: the CSP blocks network requests from the page, but it
// cannot stop anyone sharing an exported file (docs/plan.md §5, risk 10).

export const noticeCopy = {
  title: 'Before you start',
  intro: 'Graticule maps working relationships between named people. Please read this first.',
  points: [
    {
      heading: 'Your data stays in this browser.',
      body: 'Graticule has no server. Files you import are processed on this device, and the page is blocked from sending data to other sites. Exports you save are ordinary files, so take care with where you share them.',
    },
    {
      heading: 'Ask for informed consent.',
      body: 'Before anyone takes part, tell them what will be collected, who will see the results and how the results will be used.',
    },
    {
      heading: 'Do not use the results to evaluate individuals.',
      body: 'Graticule describes the structure of a network. Its results are not a measure of anyone’s performance and should not be used in performance evaluation.',
    },
    {
      heading: 'Seek data protection advice.',
      body: 'Processing named employee data is likely to engage data protection law. Seek appropriate advice before you collect or load any data.',
    },
  ],
  reopen: 'You can read this notice again from the Help menu.',
  confirm: 'Continue',
} as const;
