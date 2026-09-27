// Analyst-facing wording for surveys (spec §15.1, 15.5). Respondent wording
// lives in src/respond/copy.ts.

import type { RejectReason } from '../../data/schema';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export const surveyCopy = {
  tab: 'Survey',
  heading: 'Survey',
  needMembers: {
    heading: 'Add the people you will survey',
    body: 'A survey asks every member of the project about their colleagues. Import a members file first: it lists each person’s id and name, and can include an email column for sending links.',
    action: 'Import members',
  },
  intro: {
    heading: 'Run a survey',
    body: 'Each person receives a personal link, answers on their phone or computer, and sends you back an encrypted response. You import all the responses here. Nothing passes through a server.',
    start: 'Set up a survey',
  },
  choose: 'Survey',
  another: 'Set up another survey',

  setup: {
    createHeading: 'Set up a survey',
    editHeading: 'Edit the survey',
    title: 'Survey title',
    titleHelp: 'Respondents see this at the top of every screen.',
    questions: 'Questions',
    questionsHelp:
      'Choose the layers to ask about. Respondents rate each colleague they are asked about; the wording is theirs to read, so edit it freely.',
    include: (label: string) => `Ask about ${label}`,
    shortName: 'Short name shown to respondents',
    shortNameHelp:
      'Respondents see this in their summary of answers. Use everyday words: “Relationship quality” rather than “Valence”.',
    wording: 'Question wording',
    scaleLabels: 'Scale labels',
    scalePoint: (v: string) => `Label for ${v}`,
    unselected: 'If a colleague is not selected, record',
    unselectedZero: (label: string) => `The lowest point: ${label}`,
    unselectedNone: 'Nothing (not rated)',
    entry: 'How respondents choose colleagues',
    nominate: 'Select colleagues, then rate them',
    nominateHelp:
      'Respondents first select the colleagues they work with, then answer only about them. Shorter for large rosters. Respondents are told what not selecting someone records.',
    full: 'Rate every colleague',
    fullHelp: 'Respondents answer every question about every colleague on the roster.',
    nominationQuestion: 'Selection question',
    texts: 'What respondents read',
    introduction: 'Introduction',
    introductionHelp: 'The purpose of the survey and how the results will be used.',
    confidentiality: 'Confidentiality statement',
    confidentialityHelp:
      'Who will see the answers and the results. Responses are confidential, not anonymous: you will see who gave which ratings. Do not describe them as anonymous.',
    returnInstructions: 'Return instructions',
    returnHelp:
      'Where respondents send their encrypted response, for example an email address or a file-request link.',
    deadline: 'Deadline (optional)',
    wave: 'Wave',
    waveHelp: 'Ratings from this survey are imported into this wave.',
    shared: 'Shown beside names',
    sharedHelp: 'Attributes respondents see next to each colleague’s name. None by default.',
    estimate: 'Estimated time for each respondent',
    estimateValue: (m: number) => `About ${plural(m, 'minute', 'minutes')}`,
    estimateBasis:
      'From the roster size, the number of questions and the method: 5 seconds a rating, 2 seconds to consider each colleague for selection, and a minute to read the introduction.',
    expected: 'Expected colleagues selected',
    limit: 'Time limit for the warning (minutes)',
    burden: (m: number, limit: number) =>
      `About ${String(m)} minutes is more than the ${String(limit)}-minute limit. Long surveys are abandoned or answered carelessly: ask about fewer layers, or let respondents select colleagues first.`,
    links: 'Links',
    linkAuto: 'Personal links, or a survey file when the links would be too long',
    linkAutoHelp:
      'A link carries the whole survey and works on its own up to 2,000 characters. Longer surveys use a shared survey file with a short personal link.',
    linkPackage: 'Always use a survey file with short links',
    linkPackageHelp:
      'Choose this if your organisation’s email rewrites links for security scanning, which makes long links longer.',
    missing: {
      title: 'Add a title.',
      layers: 'Choose at least one question.',
      wording: 'Every question needs a short name and wording.',
      introduction: 'Add an introduction.',
      confidentiality: 'Add a confidentiality statement.',
      returnInstructions: 'Add return instructions.',
      nominationQuestion: 'Add a selection question.',
      roster: 'The project needs at least two members.',
      wave: 'The wave must be a whole number from 1.',
    } as Record<string, string>,
    save: 'Save changes',
    cancel: 'Cancel',
    newVersionTitle: 'Create a new version?',
    newVersionBody: (v: number) =>
      `Links have been issued, and this change alters who is asked or what they are asked. It creates version ${String(v)}. Links already sent stay valid for the version they belong to, and their responses are mapped to the new version on import.`,
    issueAll: 'Issue new links to everyone',
    issueNew: 'Issue links only to people without one',
    saved: 'Survey saved',
    versionCreated: (v: number) => `Survey saved as version ${String(v)}`,
  },

  keys: {
    heading: 'Protect the responses',
    body: 'Responses are encrypted to a key that only this survey holds. The key is stored in the project file, locked with a passphrase you choose. You need the passphrase to read the responses.',
    passphrase: 'Passphrase',
    passphraseHelp:
      'At least 12 characters. A few unrelated words are easy to remember and hard to guess.',
    confirm: 'Type the passphrase again',
    tooShort: 'Use at least 12 characters.',
    mismatch: 'The two passphrases differ.',
    create: 'Create the key',
    creating: 'Creating the key…',
    backupHeading: 'Download a key backup',
    backupBody:
      'If the project file is lost, or the passphrase is forgotten, the responses cannot be read by anyone, including you. Download a backup of the key now and keep it somewhere safe, apart from the project file.',
    download: 'Download key backup',
    checkHeading: 'Check the backup',
    checkBody:
      'Choose the backup file you just saved. Graticule opens it with your passphrase, to confirm that the file and the passphrase both work.',
    choose: 'Choose the backup file',
    checking: 'Checking the backup…',
    notBackup:
      'This is not a Graticule key backup. Choose the file you downloaded, whose name starts with graticule-key.',
    otherSurvey:
      'This backup belongs to another survey. Choose the backup you downloaded for this one.',
    passphraseWrong:
      'The passphrase does not open this backup. Check the passphrase, then choose the file again.',
    verified: 'Backup checked: the file and the passphrase both open the key.',
    finish: 'Create the survey',
    created: 'Survey created',
    lossWarning:
      'Without the key and its passphrase, the responses cannot be read. Graticule cannot recover them.',
  },

  dashboard: {
    status: { open: 'Open', closed: 'Closed' },
    version: (v: number) => `Version ${String(v)}`,
    issued: 'Links issued',
    imported: 'Responses imported',
    rate: 'Response rate',
    rateAgainst: (rate: string, threshold: string, below: boolean) =>
      below
        ? `${rate}, below the ${threshold} coverage threshold`
        : `${rate}, at or above the ${threshold} coverage threshold`,
    duplicates: 'Duplicate submissions',
    rejected: 'Rejected files',
    edit: 'Edit survey',
    close: 'Close survey',
    reopen: 'Reopen survey',
    closedNote: 'This survey is closed, so responses cannot be imported. Reopen it to import more.',
    closeTitle: 'Close the survey?',
    closeBody:
      'Closing stops further responses from being imported until you reopen the survey. Responses already imported stay.',
    closed: 'Survey closed',
    reopened: 'Survey reopened',
    backupAgain: 'Download key backup',

    unlockHeading: 'Unlock responses',
    unlockBody:
      'Enter the survey passphrase to decrypt responses. It is kept in this page’s memory only, and forgotten when you reload or close the page.',
    unlock: 'Unlock',
    unlocking: 'Unlocking…',
    unlocked: 'Responses can be decrypted until you lock them or leave the page.',
    lock: 'Lock',
    wrongPassphrase: 'The passphrase does not open this survey’s key.',

    importHeading: 'Import responses',
    drop: 'Drop response files here, or',
    chooseFiles: 'Choose response files',
    paste: 'Or paste response text from emails',
    pasteHelp: 'Paste one or more blocks, each starting with “BEGIN GRATICULE RESPONSE”.',
    read: 'Read responses',
    reading: 'Reading responses…',
    nothing: 'Add response files or paste response text first.',
    pastedSource: (n: number) => `Pasted text ${String(n)}`,

    planHeading: 'Before you import',
    planAccepted: (n: number) => `${plural(n, 'response', 'responses')} to import`,
    planReplaced: (n: number) =>
      `${plural(n, 'earlier response', 'earlier responses')} replaced by a later one`,
    planDuplicates: (n: number) =>
      `${plural(n, 'duplicate', 'duplicates')}: the latest submission from each person is kept`,
    planAlready: (n: number) =>
      `${plural(n, 'file was', 'files were')} already imported and will not change anything`,
    planRejected: (n: number) => `${plural(n, 'file', 'files')} rejected`,
    mappingHeading: 'Responses to an earlier version',
    mapping: (receipt: string, version: number) =>
      `Response ${receipt} answered version ${String(version)}.`,
    droppedLayers: (list: string) =>
      `Not imported, because the survey no longer asks them: ${list}.`,
    droppedColleagues: (list: string) =>
      `Not imported, because they are no longer on the roster: ratings of ${list}.`,
    notAsked: (list: string) => `Not asked in that version: ${list}.`,
    confirm: (n: number) => `Import ${plural(n, 'response', 'responses')}`,
    confirmNone: 'Record the rejected files',
    cancel: 'Cancel',
    done: (n: number, ratings: number) =>
      `${plural(n, 'response', 'responses')} imported, ${plural(ratings, 'rating', 'ratings')} added`,
    deleteReminder:
      'Now delete the response files and the emails that carried them. They are personal data, and their answers are now in your project.',
    dismiss: 'Done',

    linksHeading: 'Links',
    linksHelp:
      'Send each person their own link. Links identify people, so send them only to the person named.',
    packageHelp: (file: string) =>
      `This survey is too long for links on their own. Send everyone the same survey file (${file}) together with their own short link.`,
    packageAlways: (file: string) =>
      `Send everyone the same survey file (${file}) together with their own short link.`,
    downloadPackage: (v: number) => `Download survey file for version ${String(v)}`,
    exportLinks: 'Export links for mail merge',
    exportNonResponders: 'Export non-responders',
    exported: (file: string) => `Exported ${file}`,
    personalData: 'These files contain names, email addresses and personal links.',
    columns: { name: 'Name', version: 'Version', status: 'Response', link: 'Link' },
    responded: 'Received',
    waiting: 'Not yet',
    copy: 'Copy link',
    copyFor: (name: string) => `Copy link for ${name}`,
    copied: (name: string) => `Link copied for ${name}`,
    copyFailed: 'The link could not be copied. Your browser blocked the clipboard.',
    building: 'Preparing links…',

    rejectedHeading: 'Rejected files',
    rejectedColumns: { source: 'File', receipt: 'Receipt', reason: 'Reason', when: 'Imported' },
    noRejected: 'No files have been rejected.',
    duplicatesHeading: 'Duplicate submissions',
    duplicate: (name: string, kept: string, setAside: string) =>
      `${name}: kept ${kept}, set aside ${setAside}.`,
  },

  reason(r: RejectReason): string {
    switch (r) {
      case 'unreadable':
        return 'No readable response: the file or text is not a Graticule response, or it is incomplete.';
      case 'other_survey':
        return 'The response belongs to another survey.';
      case 'other_key':
        return 'The response was encrypted for another survey key.';
      case 'tampered':
        return 'The response failed its integrity check: it has been changed or damaged.';
      case 'unknown_version':
        return 'The response answers a survey version this project does not have.';
      case 'unknown_token':
        return 'The response’s token was not issued by this survey.';
      case 'token_mismatch':
        return 'The response’s token does not match the person it names.';
      case 'already_imported':
        return 'This response was already imported.';
      case 'closed':
        return 'The survey was closed.';
    }
  },
} as const;
