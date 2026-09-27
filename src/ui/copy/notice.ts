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
  survey: {
    heading: 'If you run a survey',
    points: [
      {
        heading: 'Tell participants before they respond.',
        body: 'Each person must be told the purpose, the confidentiality terms and who will see the results before answering. Graticule will not issue a survey without an introduction and a confidentiality statement.',
      },
      {
        heading: 'Responses are confidential, not anonymous.',
        body: 'You will see who gave which ratings, because the method needs it. Say so to participants, and never describe the survey as anonymous.',
      },
      {
        heading: 'Take particular care with negative ratings.',
        body: 'Ratings of named colleagues on valence, energy or conflict are sensitive. Ask for them only with a clear purpose, and protect them accordingly.',
      },
      {
        heading: 'Delete response files once imported.',
        body: 'Response files and the emails that carried them are personal data. Delete them once their responses are in your project.',
      },
    ],
  },
  reopen: 'You can read this notice again from the Help menu.',
  confirm: 'Continue',
} as const;
