// Validation of imported members and ties files (spec §5).
//
// Rules:
// - Nothing is coerced. A cell that is not exactly a valid value makes its row
//   invalid, and the row is skipped if the user imports; it is never rounded,
//   clamped, guessed or defaulted to 0.
// - Every problem carries the spreadsheet row number (the header is row 1).
// - Rows that share a key are all skipped, because choosing one would be a
//   silent decision.
// - Two things are read rather than rejected, and are reported as notes: an
//   empty value cell is a rating that was not given (stored as null, never 0),
//   and an empty wave cell is wave 1 (spec §2).
// Issues are structured; the wording lives in ui/copy/import.ts.

import { DEFAULT_ATTRIBUTES } from '../defaults';
import {
  DEFAULT_WAVE,
  isCategorical,
  tieKey,
  type AttributeDefinition,
  type LayerDefinition,
  type Member,
  type MemberId,
  type Tie,
} from '../schema';
import { normaliseHeader, type RawTable } from './table';

export type ErrorCode =
  | 'empty_file'
  | 'missing_column'
  | 'duplicate_column'
  | 'malformed_row'
  | 'missing_field'
  | 'duplicate_id'
  | 'unknown_id'
  | 'self_rating'
  | 'self_manager'
  | 'unknown_variable'
  | 'non_numeric'
  | 'out_of_range'
  | 'unknown_category'
  | 'invalid_wave'
  | 'duplicate';

export type NoteCode = 'not_rated' | 'disabled_layer' | 'later_wave' | 'new_attribute';

export type FileKind = 'members' | 'ties';

export interface Issue {
  file: FileKind;
  severity: 'error' | 'note';
  code: ErrorCode | NoteCode;
  /** Spreadsheet row, or null for a problem with the whole file or a summary note. */
  row: number | null;
  column: string | null;
  value: string | null;
  /** Details for the message, e.g. the valid range or the other rows of a duplicate. */
  detail?: {
    min?: number;
    max?: number;
    categories?: string[];
    rows?: number[];
    count?: number;
    suggestion?: string;
    skippedMember?: boolean;
    existing?: boolean;
    variable?: string;
  };
}

export interface FileReport {
  file: FileKind;
  fileName: string;
  /** Data rows read, excluding the header and fully blank rows. */
  totalRows: number;
  validRows: number;
  skippedRows: number;
  /** True when the file cannot be imported at all, e.g. a required column is missing. */
  blocked: boolean;
  issues: Issue[];
}

export interface MembersResult {
  members: Member[];
  attributes: AttributeDefinition[];
  /** Ids whose rows were skipped, so ties that mention them can say why. */
  skippedIds: Set<MemberId>;
  report: FileReport;
}

export interface TiesResult {
  ties: Tie[];
  report: FileReport;
}

export const MEMBER_COLUMNS = ['id', 'display_name'] as const;
export const TIE_COLUMNS = ['rater_id', 'ratee_id', 'variable', 'value'] as const;
export const OPTIONAL_TIE_COLUMNS = ['wave'] as const;

// Plain decimal numbers only: an optional sign, digits, an optional fraction.
// "3,5", "1e1", "0x5", "five" and "3 " inside other text are not numbers here.
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const WHOLE = /^\d+$/;

interface Columns {
  index: Map<string, number>;
  issues: Issue[];
}

function readColumns(table: RawTable, file: FileKind, required: readonly string[]): Columns {
  const index = new Map<string, number>();
  const issues: Issue[] = [];
  table.headers.forEach((h, i) => {
    const name = normaliseHeader(h);
    if (name === '') return;
    if (index.has(name)) {
      issues.push({
        file,
        severity: 'error',
        code: 'duplicate_column',
        row: 1,
        column: name,
        value: h,
      });
    } else index.set(name, i);
  });
  for (const name of required) {
    if (!index.has(name)) {
      issues.push({
        file,
        severity: 'error',
        code: 'missing_column',
        row: 1,
        column: name,
        value: null,
      });
    }
  }
  return { index, issues };
}

function cell(cells: string[], index: Map<string, number>, column: string): string {
  const i = index.get(column);
  return i === undefined ? '' : (cells[i] ?? '').trim();
}

function emptyReport(file: FileKind, table: RawTable, issues: Issue[]): FileReport {
  return {
    file,
    fileName: table.fileName,
    totalRows: table.rows.length,
    validRows: 0,
    skippedRows: table.rows.length,
    blocked: true,
    issues,
  };
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------- members

export function validateMembers(table: RawTable): MembersResult {
  const file: FileKind = 'members';
  if (table.headers.every((h) => h.trim() === '') && table.rows.length === 0) {
    const issue: Issue = {
      file,
      severity: 'error',
      code: 'empty_file',
      row: null,
      column: null,
      value: null,
    };
    return {
      members: [],
      attributes: [],
      skippedIds: new Set(),
      report: emptyReport(file, table, [issue]),
    };
  }
  const { index, issues } = readColumns(table, file, MEMBER_COLUMNS);
  if (issues.length > 0) {
    return {
      members: [],
      attributes: [],
      skippedIds: new Set(),
      report: emptyReport(file, table, issues),
    };
  }

  const builtinKeys = new Set(DEFAULT_ATTRIBUTES.map((a) => a.key));
  const extraColumns = [...index.keys()].filter(
    (c) => !builtinKeys.has(c) && !(MEMBER_COLUMNS as readonly string[]).includes(c),
  );
  const attributeColumns = [
    ...DEFAULT_ATTRIBUTES.map((a) => a.key).filter((k) => index.has(k)),
    ...extraColumns,
  ];

  const bad = new Map<number, Issue[]>(); // row → errors
  const flag = (issue: Issue) => {
    if (issue.row === null) return;
    const list = bad.get(issue.row) ?? [];
    list.push(issue);
    bad.set(issue.row, list);
  };
  const malformed = new Set(table.malformedRows);

  const rowsById = new Map<string, number[]>();
  for (const { row, cells } of table.rows) {
    if (malformed.has(row)) {
      flag({ file, severity: 'error', code: 'malformed_row', row, column: null, value: null });
      continue;
    }
    const id = cell(cells, index, 'id');
    const name = cell(cells, index, 'display_name');
    if (id === '') {
      flag({ file, severity: 'error', code: 'missing_field', row, column: 'id', value: null });
    } else rowsById.set(id, [...(rowsById.get(id) ?? []), row]);
    if (name === '') {
      flag({
        file,
        severity: 'error',
        code: 'missing_field',
        row,
        column: 'display_name',
        value: null,
      });
    }
    const manager = cell(cells, index, 'manager_id');
    if (manager !== '' && manager === id) {
      flag({
        file,
        severity: 'error',
        code: 'self_manager',
        row,
        column: 'manager_id',
        value: manager,
      });
    }
  }
  for (const [id, rows] of rowsById) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      flag({
        file,
        severity: 'error',
        code: 'duplicate_id',
        row,
        column: 'id',
        value: id,
        detail: { rows: rows.filter((r) => r !== row) },
      });
    }
  }

  // Managers must be members who are themselves imported. Skipping one row can
  // invalidate the rows that name it as manager, so repeat until stable.
  const allIds = new Set(rowsById.keys());
  let changed = true;
  while (changed) {
    changed = false;
    const validIds = new Set<string>();
    for (const { row, cells } of table.rows) {
      if (!bad.has(row)) validIds.add(cell(cells, index, 'id'));
    }
    for (const { row, cells } of table.rows) {
      if (bad.has(row)) continue;
      const manager = cell(cells, index, 'manager_id');
      if (manager === '' || validIds.has(manager)) continue;
      flag({
        file,
        severity: 'error',
        code: 'unknown_id',
        row,
        column: 'manager_id',
        value: manager,
        detail: { skippedMember: allIds.has(manager) },
      });
      changed = true;
    }
  }

  const members: Member[] = [];
  const skippedIds = new Set<MemberId>();
  for (const { row, cells } of table.rows) {
    const id = cell(cells, index, 'id');
    if (bad.has(row)) {
      if (id !== '') skippedIds.add(id);
      continue;
    }
    const attributes: Record<string, string | null> = {};
    for (const column of attributeColumns) {
      const value = cell(cells, index, column);
      attributes[column] = value === '' ? null : value;
    }
    members.push({ id, display_name: cell(cells, index, 'display_name'), attributes });
  }
  // An id that is also on a valid row is not "skipped" (only duplicates share ids,
  // and all duplicate rows are skipped).
  for (const m of members) skippedIds.delete(m.id);

  const attributes: AttributeDefinition[] = DEFAULT_ATTRIBUTES.map((a) => ({ ...a }));
  for (const column of extraColumns) {
    const header = table.headers[index.get(column) ?? -1]?.trim() ?? column;
    attributes.push({ key: column, label: header, type: 'categorical', builtin: false });
  }
  for (const def of attributes) {
    if (def.type === 'member_ref') continue;
    const values = new Set<string>();
    for (const m of members) {
      const v = m.attributes[def.key];
      if (v != null) values.add(v);
    }
    if (values.size > 0) def.categories = [...values].sort(naturalCompare);
  }

  const notes: Issue[] = extraColumns.map((column) => ({
    file,
    severity: 'note',
    code: 'new_attribute',
    row: null,
    column,
    value: null,
  }));

  const errors = [...bad.values()].flat().sort(byRow);
  return {
    members,
    attributes,
    skippedIds,
    report: {
      file,
      fileName: table.fileName,
      totalRows: table.rows.length,
      validRows: members.length,
      skippedRows: table.rows.length - members.length,
      blocked: false,
      issues: [...errors, ...notes],
    },
  };
}

function byRow(a: Issue, b: Issue): number {
  return (a.row ?? 0) - (b.row ?? 0);
}

// ---------------------------------------------------------------- ties

export interface TieContext {
  memberIds: ReadonlySet<MemberId>;
  /** Members whose rows were skipped in the members file, for clearer messages. */
  skippedMemberIds?: ReadonlySet<MemberId>;
  layers: readonly LayerDefinition[];
  /** Ratings already in the project; a row that repeats one is a duplicate. */
  existingKeys?: ReadonlySet<string>;
}

export function validateTies(table: RawTable, context: TieContext): TiesResult {
  const file: FileKind = 'ties';
  if (table.headers.every((h) => h.trim() === '') && table.rows.length === 0) {
    const issue: Issue = {
      file,
      severity: 'error',
      code: 'empty_file',
      row: null,
      column: null,
      value: null,
    };
    return { ties: [], report: emptyReport(file, table, [issue]) };
  }
  const { index, issues } = readColumns(table, file, TIE_COLUMNS);
  if (issues.length > 0) return { ties: [], report: emptyReport(file, table, issues) };

  const layers = new Map(context.layers.map((l) => [l.key, l]));
  const labels = new Map(context.layers.map((l) => [l.label.toLowerCase(), l.key]));
  const malformed = new Set(table.malformedRows);
  const errors: Issue[] = [];
  const candidates: { row: number; tie: Tie; key: string }[] = [];

  for (const { row, cells } of table.rows) {
    const rowErrors: Issue[] = [];
    const err = (
      code: ErrorCode,
      column: string | null,
      value: string | null,
      detail?: Issue['detail'],
    ) => {
      rowErrors.push({
        file,
        severity: 'error',
        code,
        row,
        column,
        value,
        ...(detail ? { detail } : {}),
      });
    };
    // A row the parser could not read has unreliable cells; say only that.
    if (malformed.has(row)) {
      err('malformed_row', null, null);
      errors.push(...rowErrors);
      continue;
    }

    const rater = cell(cells, index, 'rater_id');
    const ratee = cell(cells, index, 'ratee_id');
    for (const [column, id] of [
      ['rater_id', rater],
      ['ratee_id', ratee],
    ] as const) {
      if (id === '') err('missing_field', column, null);
      else if (!context.memberIds.has(id)) {
        err('unknown_id', column, id, {
          skippedMember: context.skippedMemberIds?.has(id) ?? false,
        });
      }
    }
    if (rater !== '' && rater === ratee) err('self_rating', 'ratee_id', ratee);

    const variable = cell(cells, index, 'variable');
    const layer = layers.get(variable);
    if (variable === '') err('missing_field', 'variable', null);
    else if (!layer) {
      const suggestion = labels.get(variable.toLowerCase());
      err('unknown_variable', 'variable', variable, suggestion ? { suggestion } : undefined);
    }

    const waveText = cell(cells, index, 'wave');
    let wave = DEFAULT_WAVE;
    if (waveText !== '') {
      if (WHOLE.test(waveText) && Number(waveText) >= 1) wave = Number(waveText);
      else err('invalid_wave', 'wave', waveText);
    }

    const text = cell(cells, index, 'value');
    let value: Tie['value'] = null;
    if (text !== '' && layer) {
      if (isCategorical(layer)) {
        const categories = layer.categories ?? [];
        if (categories.includes(text)) value = text;
        else err('unknown_category', 'value', text, { categories, variable: layer.key });
      } else if (!NUMBER.test(text)) {
        err('non_numeric', 'value', text, { variable: layer.key });
      } else {
        const n = Number(text);
        if (n < layer.min || n > layer.max) {
          err('out_of_range', 'value', text, {
            min: layer.min,
            max: layer.max,
            variable: layer.key,
          });
        } else value = n;
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
    if (
      rater !== '' &&
      ratee !== '' &&
      variable !== '' &&
      !rowErrors.some((e) => e.code === 'invalid_wave')
    ) {
      const tie: Tie = { rater_id: rater, ratee_id: ratee, variable, value, wave };
      candidates.push({ row, tie, key: tieKey(rater, ratee, variable, wave) });
    }
  }

  // Duplicates: every row that shares a key is skipped, and a row that repeats a
  // rating already in the project is skipped rather than overwriting it.
  const rowsByKey = new Map<string, number[]>();
  for (const c of candidates) rowsByKey.set(c.key, [...(rowsByKey.get(c.key) ?? []), c.row]);
  for (const c of candidates) {
    const rows = rowsByKey.get(c.key) ?? [];
    const existing = context.existingKeys?.has(c.key) ?? false;
    if (rows.length > 1 || existing) {
      errors.push({
        file,
        severity: 'error',
        code: 'duplicate',
        row: c.row,
        column: null,
        value: null,
        detail: { rows: rows.filter((r) => r !== c.row), existing },
      });
    }
  }

  const badRows = new Set(errors.map((e) => e.row));
  const ties = candidates.filter((c) => !badRows.has(c.row)).map((c) => c.tie);

  // Notes summarise what was read without being rejected.
  const notes: Issue[] = [];
  const count = (pred: (t: Tie) => boolean) => ties.filter(pred).length;
  const notRated = count((t) => t.value === null);
  if (notRated > 0) {
    notes.push({
      file,
      severity: 'note',
      code: 'not_rated',
      row: null,
      column: 'value',
      value: null,
      detail: { count: notRated },
    });
  }
  for (const layer of context.layers) {
    const n = layer.enabled ? 0 : count((t) => t.variable === layer.key);
    if (n > 0) {
      notes.push({
        file,
        severity: 'note',
        code: 'disabled_layer',
        row: null,
        column: 'variable',
        value: layer.key,
        detail: { count: n, variable: layer.key },
      });
    }
  }
  const later = count((t) => t.wave !== DEFAULT_WAVE);
  if (later > 0) {
    notes.push({
      file,
      severity: 'note',
      code: 'later_wave',
      row: null,
      column: 'wave',
      value: null,
      detail: { count: later },
    });
  }

  errors.sort(byRow);
  return {
    ties,
    report: {
      file,
      fileName: table.fileName,
      totalRows: table.rows.length,
      validRows: ties.length,
      skippedRows: table.rows.length - ties.length,
      blocked: false,
      issues: [...errors, ...notes],
    },
  };
}
