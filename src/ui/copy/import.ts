// Wording for import and the validation report (spec §5, §12: errors say what
// went wrong and how to fix it). The validator emits structured issues; this
// file turns them into sentences.

import type { Issue } from '../../data/import/validate';

const n = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

const rowList = (rows: number[] | undefined) =>
  rows && rows.length > 0
    ? `${rows.length === 1 ? 'row' : 'rows'} ${rows.map(String).join(', ')}`
    : '';

const quote = (v: string | null) => `“${v ?? ''}”`;

export const importCopy = {
  title: 'Import survey data',
  intro:
    'Choose a members file and, if you have one, a ties file. Both can be CSV or XLSX. The files are checked before anything is imported.',
  membersLabel: 'Members file',
  membersHelp: 'One row per member. Required columns: id, display_name.',
  tiesLabel: 'Ties file',
  tiesHelp:
    'One row per rating. Required columns: rater_id, ratee_id, variable, value. Optional: wave.',
  tiesOnlyHelp: 'Ties are added to the open project, whose members they must name.',
  replaceWarning:
    'Importing a members file replaces the open project. Save it first if you need it.',
  templates: 'Download a template',
  templateMembers: 'Members template (CSV)',
  templateTies: 'Ties template (CSV)',
  templateMembersXlsx: 'Members template (XLSX)',
  templateTiesXlsx: 'Ties template (XLSX)',
  chooseFile: 'Choose file',
  noFile: 'No file chosen',
  check: 'Check files',
  checking: 'Checking files…',
  cancel: 'Cancel',
  back: 'Choose other files',
  needMembers: 'Choose a members file to start a new project.',
  unreadable: (name: string, reason: string) =>
    `${name} could not be read: ${reason} Save it as CSV (UTF-8) or XLSX and try again.`,
  unsupportedType:
    'Graticule reads .csv and .xlsx files. Save the sheet in one of these formats and try again.',

  reportTitle: 'Validation report',
  rowNumbers:
    'Row numbers match your spreadsheet, where row 1 is the header. Fix the rows in your file and check it again, or import the valid rows now and skip the rest.',
  fileSummary: (valid: number, total: number) =>
    `${n(valid, 'row', 'rows')} of ${total.toLocaleString('en-GB')} can be imported.`,
  skipped: (count: number) =>
    count === 0 ? 'No rows will be skipped.' : `${n(count, 'row', 'rows')} will be skipped.`,
  blocked: 'This file cannot be imported until the problems below are fixed.',
  noProblems: 'No problems found.',
  tiesDeferred: 'The ties file is checked once the members file can be imported.',
  problemsHeading: (count: number) => n(count, 'problem', 'problems'),
  notesHeading: 'Also read from the file',
  columns: { row: 'Row', column: 'Column', value: 'Value', problem: 'Problem' },
  showAll: (count: number) => `Show all ${count.toLocaleString('en-GB')} problems`,
  importValid: (count: number) => `Import ${n(count, 'valid row', 'valid rows')}`,
  nothingToImport: 'There are no valid rows to import.',
  imported: (rows: number, skipped: number) =>
    `Imported ${n(rows, 'row', 'rows')}.` +
    (skipped > 0 ? ` ${n(skipped, 'row was', 'rows were')} skipped.` : ''),
  untitled: 'Imported project',
  file: { members: 'Members file', ties: 'Ties file' },

  problem(issue: Issue): string {
    const d = issue.detail ?? {};
    switch (issue.code) {
      case 'empty_file':
        return 'The file is empty. Add a header row and at least one data row.';
      case 'missing_column':
        return `There is no ${issue.column ?? ''} column. Add it to the header row (row 1).`;
      case 'duplicate_column':
        return `The header has more than one ${issue.column ?? ''} column. Keep one.`;
      case 'malformed_row':
        return 'This row could not be read cleanly, often because of an unclosed quotation mark. Check the row in a text editor.';
      case 'missing_field':
        return `${issue.column ?? ''} is empty. Every row needs one.`;
      case 'duplicate_id':
        return `The id ${quote(issue.value)} is also used on ${rowList(d.rows)}. Each member needs a unique id; all rows that share it are skipped.`;
      case 'unknown_id':
        return d.skippedMember
          ? `${quote(issue.value)} is in the members file, but its row has a problem and will be skipped. Fix that row first.`
          : `${quote(issue.value)} is not an id in the members file. Check the spelling, or add the member.`;
      case 'self_rating':
        return 'The rater and the person rated are the same member. Self-ratings are not recorded; remove the row.';
      case 'self_manager':
        return 'A member cannot be their own manager. Leave manager_id empty or name another member.';
      case 'unknown_variable':
        return d.suggestion
          ? `${quote(issue.value)} is not a layer key. Did you mean ${d.suggestion}? Variables use the layer key, not its label.`
          : `${quote(issue.value)} is not a layer in this project. Use a layer key such as connection_strength.`;
      case 'non_numeric':
        return `${quote(issue.value)} is not a number. Enter a plain number such as 3 or -2, or leave the cell empty if no rating was given.`;
      case 'out_of_range':
        return `${quote(issue.value)} is outside the ${d.variable ?? ''} scale, which runs from ${String(d.min)} to ${String(d.max)}.`;
      case 'unknown_category':
        return `${quote(issue.value)} is not a category of ${d.variable ?? 'this layer'}. Use one of: ${(d.categories ?? []).join(', ')}.`;
      case 'invalid_wave':
        return `${quote(issue.value)} is not a wave number. Use a whole number from 1, or leave the cell empty for wave 1.`;
      case 'duplicate':
        return d.existing
          ? 'The open project already has this rating. It is not overwritten; remove the row or edit the rating in the matrix.'
          : `The same rater, person rated, variable and wave also appear on ${rowList(d.rows)}. All of these rows are skipped; keep one.`;
      case 'not_rated':
        return `${n(d.count ?? 0, 'row has', 'rows have')} an empty value. ${(d.count ?? 0) === 1 ? 'It is' : 'They are'} stored as not rated, not as 0.`;
      case 'not_applicable':
        return `${n(d.count ?? 0, 'row says', 'rows say')} n/a. ${(d.count ?? 0) === 1 ? 'It is' : 'They are'} stored as “does not apply”: not 0, and left out of coverage.`;
      case 'disabled_layer':
        return `${n(d.count ?? 0, 'rating is', 'ratings are')} for ${d.variable ?? ''}, a layer that is turned off. They are imported and used when you turn the layer on.`;
      case 'later_wave':
        return `${n(d.count ?? 0, 'rating is', 'ratings are')} for wave 2 or later. They are stored; this version shows wave 1 only.`;
      case 'other_sheets':
        return `Only the first sheet was read. ${n(d.sheets?.length ?? 0, 'other sheet was', 'other sheets were')} not read: ${(d.sheets ?? []).join(', ')}.`;
      case 'new_attribute':
        return `The column ${issue.column ?? ''} becomes a new member attribute.`;
    }
  },
} as const;
