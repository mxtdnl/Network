import { describe, expect, it } from 'vitest';
import { defaultLayers } from '../../src/data/defaults';
import { parseCsv } from '../../src/data/import/csv';
import { validateMembers, validateTies, type Issue } from '../../src/data/import/validate';
import { tieKey } from '../../src/data/schema';
import {
  expectedCounts,
  expectedErrors,
  seededMembersCsv,
  seededTiesCsv,
} from '../fixtures/validation/seeded-errors';

function run() {
  const members = validateMembers(parseCsv('members.csv', seededMembersCsv));
  const ties = validateTies(parseCsv('ties.csv', seededTiesCsv), {
    memberIds: new Set(members.members.map((m) => m.id)),
    skippedMemberIds: members.skippedIds,
    layers: defaultLayers(),
  });
  return { members, ties };
}

const errorsOf = (issues: Issue[]) =>
  issues.filter((i) => i.severity === 'error').map((i) => [i.row, i.code]);

describe('validation report on the seeded fixture', () => {
  const { members, ties } = run();

  it('lists every seeded members error with its row number, and nothing else', () => {
    expect(errorsOf(members.report.issues)).toEqual(expectedErrors.members);
  });

  it('lists every seeded ties error with its row number, and nothing else', () => {
    expect(errorsOf(ties.report.issues)).toEqual(expectedErrors.ties);
  });

  it('covers every problem type named in spec §5', () => {
    const codes = new Set([
      ...members.report.issues.map((i) => i.code),
      ...ties.report.issues.map((i) => i.code),
    ]);
    for (const code of [
      'unknown_id',
      'self_rating',
      'out_of_range',
      'duplicate',
      'duplicate_id',
      'unknown_variable',
      'non_numeric',
    ]) {
      expect(codes).toContain(code);
    }
  });

  it('counts valid and skipped rows', () => {
    for (const [result, counts] of [
      [members.report, expectedCounts.members],
      [ties.report, expectedCounts.ties],
    ] as const) {
      expect(result.totalRows).toBe(counts.total);
      expect(result.validRows).toBe(counts.valid);
      expect(result.skippedRows).toBe(counts.skipped);
      expect(result.blocked).toBe(false);
    }
  });

  it('imports only the valid rows, with values exactly as written', () => {
    expect(members.members.map((m) => m.id)).toEqual(['A01', 'A02', 'A03']);
    expect(members.members[0]?.attributes).toEqual({
      team: 'Finance',
      level: 'L4',
      location: 'Leeds',
      tenure_band: 'Over 5 years',
      manager_id: null,
      office_floor: '3',
    });
    expect(ties.ties).toEqual([
      { rater_id: 'A01', ratee_id: 'A02', variable: 'connection_strength', value: 4, wave: 1 },
      { rater_id: 'A02', ratee_id: 'A01', variable: 'connection_strength', value: 0, wave: 1 },
      { rater_id: 'A01', ratee_id: 'A03', variable: 'valence', value: -2, wave: 1 },
      { rater_id: 'A03', ratee_id: 'A01', variable: 'valence', value: null, wave: 1 },
      { rater_id: 'A01', ratee_id: 'A03', variable: 'advice', value: 3, wave: 1 },
      { rater_id: 'A01', ratee_id: 'A03', variable: 'connection_strength', value: 4, wave: 2 },
      { rater_id: 'A02', ratee_id: 'A03', variable: 'valence', value: 1, wave: 1 },
    ]);
  });

  it('reports what it read without rejecting as notes', () => {
    const notes = ties.report.issues.filter((i) => i.severity === 'note');
    expect(notes.map((n) => [n.code, n.detail?.count])).toEqual([
      ['not_rated', 1],
      ['disabled_layer', 1],
      ['later_wave', 1],
    ]);
    expect(members.report.issues.filter((i) => i.severity === 'note').map((n) => n.column)).toEqual(
      ['office_floor'],
    );
  });

  it('explains why an id is unknown when its members row was skipped', () => {
    const row16 = ties.report.issues.find((i) => i.row === 16);
    const row6 = ties.report.issues.find((i) => i.row === 6);
    expect(row16?.detail?.skippedMember).toBe(true);
    expect(row6?.detail?.skippedMember).toBe(false);
    const row11 = members.report.issues.find((i) => i.row === 11);
    expect(row11?.detail?.skippedMember).toBe(true);
  });

  it('suggests the key when a layer label is used as the variable', () => {
    const row17 = ties.report.issues.find((i) => i.row === 17);
    expect(row17?.detail?.suggestion).toBe('connection_strength');
  });

  it('names the other rows of a duplicate', () => {
    expect(ties.report.issues.find((i) => i.row === 12)?.detail?.rows).toEqual([13]);
    expect(members.report.issues.find((i) => i.row === 8)?.detail?.rows).toEqual([9]);
  });
});

describe('file-level problems block the file', () => {
  it('reports missing required columns on row 1', () => {
    const table = parseCsv('ties.csv', 'rater_id,ratee_id,value\nA,B,1');
    const result = validateTies(table, { memberIds: new Set(['A', 'B']), layers: defaultLayers() });
    expect(result.report.blocked).toBe(true);
    expect(result.report.skippedRows).toBe(1);
    expect(result.report.issues.map((i) => [i.row, i.code, i.column])).toEqual([
      [1, 'missing_column', 'variable'],
    ]);
    expect(result.ties).toEqual([]);
  });

  it('reports an empty file', () => {
    const result = validateMembers(parseCsv('members.csv', ''));
    expect(result.report.blocked).toBe(true);
    expect(result.report.issues.map((i) => i.code)).toEqual(['empty_file']);
  });

  it('reads headers regardless of case and spacing, and a byte-order mark', () => {
    const result = validateMembers(parseCsv('m.csv', '﻿ID, Display Name \nA,Ada'));
    expect(result.report.blocked).toBe(false);
    expect(result.members).toEqual([{ id: 'A', display_name: 'Ada', attributes: {} }]);
  });

  it('keeps spreadsheet row numbers across blank rows', () => {
    const table = parseCsv('t.csv', 'rater_id,ratee_id,variable,value\n\nA,A,valence,1');
    const result = validateTies(table, { memberIds: new Set(['A']), layers: defaultLayers() });
    expect(result.report.issues.map((i) => i.row)).toEqual([3]);
  });

  it('never overwrites a rating already in the project', () => {
    const table = parseCsv('t.csv', 'rater_id,ratee_id,variable,value\nA,B,valence,1');
    const result = validateTies(table, {
      memberIds: new Set(['A', 'B']),
      layers: defaultLayers(),
      existingKeys: new Set([tieKey('A', 'B', 'valence', 1)]),
    });
    expect(result.ties).toEqual([]);
    expect(result.report.issues[0]?.detail?.existing).toBe(true);
  });
});

describe('no silent coercion', () => {
  const rate = (value: string, variable = 'connection_strength') =>
    validateTies(parseCsv('t.csv', `rater_id,ratee_id,variable,value\nA,B,${variable},${value}`), {
      memberIds: new Set(['A', 'B']),
      layers: defaultLayers(),
    });

  it.each(['five', '3,5', '1e0', '0x3', '3 stars', 'NaN', 'Infinity', '−2', '--1', '.'])(
    'rejects %s as non-numeric',
    (value) => {
      const result = rate(value.includes(',') ? `"${value}"` : value);
      expect(result.ties).toEqual([]);
      expect(result.report.issues.map((i) => i.code)).toEqual(['non_numeric']);
    },
  );

  it.each([
    ['5.5', 'connection_strength'],
    ['-1', 'connection_strength'],
    ['-4', 'valence'],
  ])('rejects %s on %s as out of range rather than clamping', (value, variable) => {
    expect(rate(value, variable).report.issues.map((i) => i.code)).toEqual(['out_of_range']);
  });

  it.each([
    ['0', 0],
    ['3', 3],
    ['2.5', 2.5],
    ['+2', 2],
    ['05', 5],
  ])('reads %s as %s', (value, expected) => {
    expect(rate(value).ties[0]?.value).toBe(expected);
  });

  it('accepts category keys only, exactly', () => {
    expect(rate('video', 'primary_channel').ties[0]?.value).toBe('video');
    expect(rate('Video', 'primary_channel').report.issues[0]?.code).toBe('unknown_category');
  });
});
