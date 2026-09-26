// Writes the XLSX import templates from the CSV templates in public/templates/,
// so both formats always carry the same columns and example rows. Numeric
// columns are written as numbers, as a spreadsheet user would enter them.
//
// Run with `npm run templates` after changing a CSV template; commit the result.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { utils, write } from 'xlsx';
import { parseCsv } from '../src/data/import/csv';

const dir = join(import.meta.dirname, '..', 'public', 'templates');
const NUMERIC = new Set(['value', 'wave']);
// Fixed so the files only change when their content does.
const CREATED = new Date('2026-09-26T00:00:00Z');

for (const name of ['members', 'ties']) {
  const table = parseCsv(`${name}.csv`, readFileSync(join(dir, `${name}.csv`), 'utf8'));
  const numeric = table.headers.map((h) => NUMERIC.has(h));
  const rows = table.rows.map((r) =>
    r.cells.map((cell, i) => (numeric[i] && cell !== '' ? Number(cell) : cell)),
  );
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet([table.headers, ...rows]), name);
  book.Props = { Title: `Graticule ${name} template`, CreatedDate: CREATED, ModifiedDate: CREATED };
  const bytes = write(book, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
  writeFileSync(join(dir, `${name}.xlsx`), bytes);
  console.log(`Wrote ${join(dir, `${name}.xlsx`)}`);
}
