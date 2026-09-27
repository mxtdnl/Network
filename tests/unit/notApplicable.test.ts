// "Does not apply" (CLAUDE.md D102): a third state beside a rating and a
// missing rating, never confused with 0 and left out of coverage.

import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../../src/data/coverage';
import { createProject } from '../../src/data/defaults';
import { tableFromCells } from '../../src/data/import/table';
import { validateTies } from '../../src/data/import/validate';
import { parseProject, serialiseProject } from '../../src/data/projectFile';
import { applyRatingChanges, cellState, parseRatingInput } from '../../src/data/ratings';
import type { Project } from '../../src/data/schema';

function project(): Project {
  const p = createProject('N/A', '2026-09-27T09:00:00.000Z');
  p.members = ['A', 'B', 'C'].map((id) => ({ id, display_name: id, attributes: {} }));
  return p;
}
const valence = () => {
  const l = project().layers.find((x) => x.key === 'valence');
  if (!l) throw new Error('no valence');
  return l;
};

describe('does not apply', () => {
  it('is read from "n/a" in a ties file, with a note, and is neither 0 nor a missing rating', () => {
    const p = project();
    const table = tableFromCells('ties.csv', [
      ['rater_id', 'ratee_id', 'variable', 'value'],
      ['A', 'B', 'valence', 'N/A'],
      ['A', 'C', 'valence', '0'],
      ['B', 'A', 'valence', ''],
    ]);
    const r = validateTies(table, { memberIds: new Set(['A', 'B', 'C']), layers: p.layers });
    expect(r.report.skippedRows).toBe(0);
    expect(r.ties).toStrictEqual([
      {
        rater_id: 'A',
        ratee_id: 'B',
        variable: 'valence',
        value: null,
        wave: 1,
        not_applicable: true,
      },
      { rater_id: 'A', ratee_id: 'C', variable: 'valence', value: 0, wave: 1 },
      { rater_id: 'B', ratee_id: 'A', variable: 'valence', value: null, wave: 1 },
    ]);
    expect(r.report.issues.map((i) => [i.code, i.detail?.count])).toStrictEqual([
      ['not_rated', 1],
      ['not_applicable', 1],
    ]);
  });

  it('is entered in the matrix as n/a and shown as its own cell state', () => {
    expect(parseRatingInput(valence(), ' N/A ')).toStrictEqual({ kind: 'not_applicable' });
    expect(parseRatingInput(valence(), 'na')).toStrictEqual({ kind: 'error', code: 'non_numeric' });
    const p = applyRatingChanges(
      project(),
      'valence',
      [{ rater: 'A', ratee: 'B', kind: 'not_applicable' }],
      'now',
    );
    const tie = p.ties[0];
    expect(tie).toStrictEqual({
      rater_id: 'A',
      ratee_id: 'B',
      variable: 'valence',
      value: null,
      not_applicable: true,
      wave: 1,
      source: 'entered',
    });
    expect(cellState('A', 'B', tie)).toBe('not-applicable');
    // Entering a value afterwards replaces it.
    const q = applyRatingChanges(
      p,
      'valence',
      [{ rater: 'A', ratee: 'B', kind: 'set', value: 0 }],
      'now',
    );
    expect(q.ties[0]).toStrictEqual({
      rater_id: 'A',
      ratee_id: 'B',
      variable: 'valence',
      value: 0,
      wave: 1,
      source: 'entered',
    });
    expect(cellState('A', 'B', q.ties[0])).toBe('zero');
  });

  it('is left out of the ratings coverage counts as possible', () => {
    const p = project();
    p.layers = p.layers.map((l) => ({ ...l, enabled: l.key === 'valence' }));
    p.ties = [
      { rater_id: 'A', ratee_id: 'B', variable: 'valence', value: 1, wave: 1 },
      {
        rater_id: 'A',
        ratee_id: 'C',
        variable: 'valence',
        value: null,
        wave: 1,
        not_applicable: true,
      },
      { rater_id: 'B', ratee_id: 'A', variable: 'valence', value: null, wave: 1 },
    ];
    const c = computeCoverage(p);
    expect(
      c.raters.map((r) => [r.id, r.rated, r.declined, r.notApplicable, r.notEntered, r.possible]),
    ).toStrictEqual([
      ['A', 1, 0, 1, 0, 1],
      ['B', 0, 1, 0, 1, 2],
      ['C', 0, 0, 0, 2, 2],
    ]);
    expect(c.rate).toBeCloseTo(1 / 5);
  });

  it('round-trips through the project file, which refuses it beside a value', () => {
    const p = project();
    p.ties = [
      {
        rater_id: 'A',
        ratee_id: 'B',
        variable: 'valence',
        value: null,
        wave: 1,
        not_applicable: true,
      },
    ];
    expect(parseProject(serialiseProject(p))).toStrictEqual(p);
    const bad = serialiseProject(p).replace('"value": null', '"value": 2');
    expect(() => parseProject(bad)).toThrow(/not applicable but has a value/);
  });
});
