// A parsed spreadsheet before validation: text cells with the row numbers the
// user sees in their spreadsheet (row 1 is the header).

export interface RawRow {
  /** Spreadsheet row number; with the header on row 1, data starts at row 2. */
  row: number;
  cells: string[];
}

export interface RawTable {
  fileName: string;
  headers: string[];
  rows: RawRow[];
  /** Rows the parser could not read cleanly, e.g. an unclosed quote. */
  malformedRows: number[];
  /** Workbook sheets that were not read (XLSX reads the first sheet only). */
  ignoredSheets?: string[];
}

/** Header names are matched without regard to case, surrounding space or the
 *  choice of space, hyphen or underscore: "Display name" reads as display_name. */
export function normaliseHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Builds a table from rows of cells, the first being the header, which sits
 *  on spreadsheet row `headerRow`. Fully blank rows are left out but keep their
 *  numbers, so later rows still match the file. */
export function tableFromCells(
  fileName: string,
  cells: string[][],
  malformed: number[] = [],
  headerRow = 1,
) {
  const [header = [], ...body] = cells;
  const rows: RawRow[] = [];
  body.forEach((row, i) => {
    if (row.some((c) => c.trim() !== '')) rows.push({ row: headerRow + i + 1, cells: row });
  });
  const table: RawTable = {
    fileName,
    headers: header.map((h) => h.replace(/^\uFEFF/, '')),
    rows,
    malformedRows: malformed,
  };
  return table;
}
