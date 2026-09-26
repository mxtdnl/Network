import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { utils, write, type CellObject, type WorkSheet } from 'xlsx';
import { defaultLayers } from '../../src/data/defaults';
import { parseCsv } from '../../src/data/import/csv';
import { validateMembers, validateTies } from '../../src/data/import/validate';
import { parseXlsx } from '../../src/data/import/xlsx';

const templates = join(import.meta.dirname, '..', '..', 'public', 'templates');
const bytes = (path: string) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

function workbook(sheets: [string, WorkSheet][]): ArrayBuffer {
  const book = utils.book_new();
  for (const [name, sheet] of sheets) utils.book_append_sheet(book, sheet, name);
  const out = write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

const layers = defaultLayers();

describe('XLSX import', () => {
  it('reads the XLSX templates exactly as the CSV templates', () => {
    for (const name of ['members', 'ties']) {
      const fromXlsx = parseXlsx(`${name}.xlsx`, bytes(join(templates, `${name}.xlsx`)));
      const fromCsv = parseCsv(`${name}.csv`, readFileSync(join(templates, `${name}.csv`), 'utf8'));
      expect(fromXlsx.headers).toEqual(fromCsv.headers);
      expect(fromXlsx.rows).toEqual(fromCsv.rows);
    }
    const members = validateMembers(parseXlsx('m.xlsx', bytes(join(templates, 'members.xlsx'))));
    const ties = validateTies(parseXlsx('t.xlsx', bytes(join(templates, 'ties.xlsx'))), {
      memberIds: new Set(members.members.map((m) => m.id)),
      layers,
    });
    expect(members.report.skippedRows).toBe(0);
    expect(ties.report.skippedRows).toBe(0);
    expect(ties.ties.map((t) => t.value)).toEqual([4, 2, 3, 3, 0, null]);
  });

  it('keeps spreadsheet row numbers when the table does not start on row 1', () => {
    const sheet = utils.aoa_to_sheet([]);
    utils.sheet_add_aoa(
      sheet,
      [
        ['rater_id', 'ratee_id', 'variable', 'value'],
        ['A', 'B', 'valence', 2],
        ['A', 'A', 'valence', 1],
      ],
      { origin: 'B3' },
    );
    const table = parseXlsx('t.xlsx', workbook([['Ties', sheet]]));
    expect(table.rows.map((r) => r.row)).toEqual([4, 5]);
    const result = validateTies(table, { memberIds: new Set(['A', 'B']), layers });
    expect(result.report.issues.map((i) => [i.row, i.code])).toEqual([[5, 'self_rating']]);
    expect(result.ties[0]?.value).toBe(2);
  });

  it('reads stored values without rounding or coercion', () => {
    const sheet = utils.aoa_to_sheet([
      ['rater_id', 'ratee_id', 'variable', 'value'],
      ['A', 'B', 'connection_strength', 2.5],
      ['B', 'A', 'connection_strength', 0.5],
      ['A', 'C', 'connection_strength', true],
      ['C', 'A', 'connection_strength', 'three'],
      ['B', 'C', 'connection_strength', ''],
      ['C', 'B', 'connection_strength', 0],
    ]);
    // Displayed as 50 %, stored as 0.5: the stored value is read.
    const pct = sheet.D3 as CellObject | undefined;
    if (pct) pct.z = '0%';
    const table = parseXlsx('t.xlsx', workbook([['Ties', sheet]]));
    expect(table.rows.map((r) => r.cells[3])).toEqual(['2.5', '0.5', 'TRUE', 'three', '', '0']);
    const result = validateTies(table, { memberIds: new Set(['A', 'B', 'C']), layers });
    expect(result.ties.map((t) => t.value)).toEqual([2.5, 0.5, null, 0]);
    expect(
      result.report.issues.filter((i) => i.severity === 'error').map((i) => [i.row, i.code]),
    ).toEqual([
      [4, 'non_numeric'],
      [5, 'non_numeric'],
    ]);
  });

  it('keeps an error cell as its text, so it fails validation', () => {
    const sheet = utils.aoa_to_sheet([
      ['rater_id', 'ratee_id', 'variable', 'value'],
      ['A', 'B', 'valence', 1],
    ]);
    sheet.D2 = { t: 'e', v: 0x2a, w: '#N/A' };
    const table = parseXlsx('t.xlsx', workbook([['Ties', sheet]]));
    expect(table.rows[0]?.cells[3]).toBe('#N/A');
    const result = validateTies(table, { memberIds: new Set(['A', 'B']), layers });
    expect(result.report.issues.map((i) => i.code)).toEqual(['non_numeric']);
  });

  it('reads the first sheet only and names the others in the report', () => {
    const members = utils.aoa_to_sheet([
      ['id', 'display_name'],
      ['A', 'Ada'],
    ]);
    const notes = utils.aoa_to_sheet([['anything']]);
    const table = parseXlsx(
      'm.xlsx',
      workbook([
        ['Members', members],
        ['Notes', notes],
      ]),
    );
    expect(table.ignoredSheets).toEqual(['Notes']);
    const result = validateMembers(table);
    expect(result.members).toHaveLength(1);
    expect(result.report.issues.map((i) => [i.code, i.detail?.sheets])).toEqual([
      ['other_sheets', ['Notes']],
    ]);
  });

  it('reports an empty first sheet as an empty file', () => {
    const table = parseXlsx('m.xlsx', workbook([['Empty', utils.aoa_to_sheet([])]]));
    expect(validateMembers(table).report.issues.map((i) => i.code)).toEqual(['empty_file']);
  });

  it('refuses a file that is not a workbook', () => {
    const text = new TextEncoder().encode('rater_id,ratee_id\nA,B').buffer;
    expect(() => parseXlsx('x.xlsx', text)).toThrow('not an XLSX workbook');
  });
});
