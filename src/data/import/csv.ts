// CSV reading with Papa Parse. Every cell is kept as text; validation decides
// what it means, so nothing is converted here.

import Papa from 'papaparse';
import { tableFromCells, type RawTable } from './table';

export function parseCsv(fileName: string, text: string): RawTable {
  const result = Papa.parse<string[]>(text, {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  // Papa Parse numbers records from 0; the header is record 0, i.e. row 1.
  const malformed = [...new Set(result.errors.map((e) => (e.row === undefined ? 1 : e.row + 1)))];
  return tableFromCells(fileName, result.data, malformed);
}
