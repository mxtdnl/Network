// Every string a survey respondent reads (spec §15.4). The first screen most
// participants see of Graticule: plain, calm and exact. Responses are
// confidential and carry the respondent's name, and the page says so; the
// word "anonymous" never appears on the respondent route (spec §15.4;
// tests/unit/respond.test.ts and tests/e2e/survey.spec.ts check).

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export const respondCopy = {
  loading: 'Opening the survey…',
  saved: 'Your answers are saved on this device.',
  step: (i: number, n: number) => `Step ${String(i)} of ${String(n)}`,

  unsupported: {
    title: 'This browser cannot open the survey',
    body: 'The survey needs a recent browser: Safari 16.4 or later (on iPhone and iPad, iOS 16.4 or later), Chrome or Edge 80 or later, or Firefox 113 or later. Open your link in one of these. If you cannot, ask the person who sent it for help.',
  },
  invalid: {
    title: 'This link cannot be opened',
    body: 'The link may have been cut short or changed when it was copied. Open it again from the message you received. If it still does not open, ask the person who sent it for a new link.',
  },

  pkg: {
    title: 'Choose your survey file',
    body: 'Your link works with a survey file that was sent with it. Its name ends in .graticule-survey. Choose that file to open the survey.',
    choose: 'Choose the survey file',
    howTo: 'How to find the file',
    iphone:
      'iPhone or iPad: in Mail, touch and hold the attachment, choose Save to Files, then choose it here.',
    android: 'Android: download the attachment, then choose it here from Downloads.',
    computer: 'Computer: save the attachment, then choose it here.',
    reading: 'Opening the file…',
    notSurvey: 'This is not a survey file. Choose the file whose name ends in .graticule-survey.',
    mismatch:
      'This survey file does not belong with your link. Choose the file that was sent with this link.',
  },

  welcome: {
    time: (m: number) => `It takes about ${plural(m, 'minute', 'minutes')}.`,
    deadline: (d: string) => `Please respond by ${d}.`,
    whoHeading: 'Who will see your answers',
    confidential:
      'Your answers are confidential, and they carry your name. The people running this survey will see which ratings you gave, because mapping how people work together needs to know who each rating came from.',
    howHeading: 'How your answers are sent',
    how: 'While you work, your answers are saved only on this device, so you can close the page and return to this link later. When you finish, they are encrypted on this device and you send them back yourself, by email or as a file. Nothing is sent automatically.',
    continue: 'Continue',
  },

  consent: {
    title: 'Taking part',
    body: 'Taking part is your choice. If you would rather not, close this page: nothing has been sent.',
    agree: 'I have read the information about this survey and I agree to take part.',
    required: 'Tick the box to agree to take part, or close this page if you would rather not.',
    start: 'Start the survey',
    back: 'Back',
  },

  identity: {
    title: 'Check this link is yours',
    body: (name: string) => `This link was made for ${name}.`,
    yes: (name: string) => `Yes, I am ${name}`,
    no: 'No, I am someone else',
    notMeTitle: 'This link is for someone else',
    notMeBody:
      'Please do not answer the survey with this link. Tell the person who sent it to you, so that they can send you your own link.',
    notMeBack: 'I opened this by mistake: go back',
  },

  nominate: {
    title: 'Who you work with',
    selectedCount: (n: number) => `${plural(n, 'person', 'people')} selected`,
    askedAbout: 'You will be asked about each person you select.',
    unselectedIntro: 'For anyone you do not select, we record:',
    unselectedValue: (layer: string, label: string) => `${layer}: ${label}`,
    unselectedBlank: (layers: string) => `Nothing is recorded for ${layers}.`,
    search: 'Search by name',
    noMatch: (q: string) => `No one matches “${q}”.`,
    listLabel: 'Colleagues',
    continue: 'Continue',
    back: 'Back',
    noneSelected:
      'You have not selected anyone. Continue only if you do not work with anyone on this list.',
  },

  rate: {
    person: (i: number, n: number) => `Person ${String(i)} of ${String(n)}`,
    question: (i: number, n: number) => `Question ${String(i)} of ${String(n)}`,
    previousPerson: 'Previous person',
    nextPerson: 'Next person',
    previousQuestion: 'Previous question',
    nextQuestion: 'Next question',
    review: 'Check your answers',
    back: 'Back',
    colleague: 'Colleague',
    option: (value: string, label: string | undefined) => (label ? `${value}, ${label}` : value),
    selected: (label: string) => `Selected: ${label}`,
    noneToRate:
      'You did not select anyone, so there is nothing to rate. Go back to select colleagues, or check your answers.',
  },

  review: {
    title: 'Check your answers',
    body: 'You can change any answer before you finish.',
    unanswered: (n: number) =>
      `${plural(n, 'question is', 'questions are')} not answered. You can leave ${n === 1 ? 'it' : 'them'} blank and still finish.`,
    allAnswered: 'Every question is answered.',
    notAnswered: 'Not answered',
    change: (name: string) => `Change answers about ${name}`,
    notSelected: (n: number) => `${plural(n, 'person', 'people')} not selected.`,
    changeSelection: 'Change who you selected',
    encrypt: 'Encrypt my answers',
    encrypting: 'Encrypting…',
    failed:
      'Your answers could not be encrypted on this device. They are still saved here. Try again, or open the link in another browser.',
    back: 'Back',
  },

  done: {
    title: 'Send your answers back',
    encrypted:
      'Your answers are encrypted. Only the people running this survey can open them. One step is left: send them back.',
    stepOne: 'Copy the encrypted text, or download it as a file.',
    stepTwo: 'Send it as your survey instructions say:',
    copy: 'Copy encrypted text',
    copied: 'Encrypted text copied. Paste it into an email.',
    copyFailed:
      'The text could not be copied automatically. Select the text in the box below and copy it.',
    download: 'Download response file',
    downloaded: (file: string) => `Response file downloaded: ${file}.`,
    textLabel: 'Encrypted text',
    receiptHeading: 'Your receipt code',
    receiptHelp: 'Quote this code if you contact the survey team about your response.',
    cleared: 'Your answers have been cleared from this device.',
    latestCounts: 'If you send more than one response, the latest one counts.',
  },

  clear: {
    button: 'Clear my answers from this device',
    title: 'Clear your answers?',
    body: 'Your answers on this device will be deleted. You can start again from your link. Anything you have already sent is not affected.',
    confirm: 'Clear my answers',
    cancel: 'Keep my answers',
    done: 'Your answers have been cleared from this device.',
  },
  resumed: 'Welcome back. Your earlier answers are here.',
} as const;
