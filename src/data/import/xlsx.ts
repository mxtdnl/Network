// XLSX reading with SheetJS (Community Edition 0.20.3, installed from
// cdn.sheetjs.com and pinned by integrity hash; plan Q15). Loaded on demand.
//
// Only the first sheet is read; any others are named in the report. Every cell
// becomes text, taken from the value stored in the file rather than its display
// format, so nothing is rounded: a number is written out in full (a cell shown
// as "50%" is read as 0.5), a formula gives its last calculated value, and an
// error cell such as #N/A stays as that text and fails validation. Rows keep
// their spreadsheet numbers even when the data does not start on row 1.

import { read, utils, type CellObject, type WorkSheet } from 'xlsx';
import { tableFromCells, type RawTable } from './table';

function cellText(cell: CellObject | undefined): string {
  if (!cell) return '';
  switch (cell.t) {
    case 'n':
      return typeof cell.v === 'number' ? String(cell.v) : '';
    case 's':
      return typeof cell.v === 'string' ? cell.v : '';
    case 'b':
      return cell.v === true ? 'TRUE' : 'FALSE';
    case 'e':
      return cell.w ?? '#ERROR';
    case 'd':
      return cell.w ?? (cell.v instanceof Date ? cell.v.toISOString() : '');
    default:
      return '';
  }
}

function sheetCells(sheet: WorkSheet): { cells: string[][]; headerRow: number } {
  const ref = sheet['!ref'];
  if (!ref) return { cells: [], headerRow: 1 };
  const range = utils.decode_range(ref);
  const cells: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      row.push(cellText(sheet[utils.encode_cell({ r, c })] as CellObject | undefined));
    }
    cells.push(row);
  }
  // The header is the first row with content; rows above it are ignored.
  const first = cells.findIndex((row) => row.some((c) => c.trim() !== ''));
  if (first < 0) return { cells: [], headerRow: 1 };
  return { cells: cells.slice(first), headerRow: range.s.r + first + 1 };
}

export class NotXlsxError extends Error {
  constructor() {
    super('The file is not an XLSX workbook, although its name ends in .xlsx.');
    this.name = 'NotXlsxError';
  }
}

// An XLSX file is a ZIP package. SheetJS would otherwise read other content
// (plain text, HTML, an old .xls) under an .xlsx name, which would be a silent
// reinterpretation of the file.
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function parseXlsx(fileName: string, data: ArrayBuffer): RawTable {
  const bytes = new Uint8Array(data);
  if (!isZip(bytes)) throw new NotXlsxError();
  const workbook = read(bytes, {
    type: 'array',
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellDates: false,
  });
  const [firstName = '', ...others] = workbook.SheetNames;
  const sheet = workbook.Sheets[firstName];
  const { cells, headerRow } = sheet ? sheetCells(sheet) : { cells: [], headerRow: 1 };
  const table = tableFromCells(fileName, cells, [], headerRow);
  if (others.length > 0) table.ignoredSheets = others;
  return table;
}
