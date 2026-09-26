// "Rated 0" and "not rated" must never be conflated (spec §4.2). These tests
// follow a missing rating and a zero rating through every stage that exists so
// far: types, import, project files, coverage, matrix entry and paste.

import { describe, expect, expectTypeOf, it } from 'vitest';
import { computeCoverage } from '../../src/data/coverage';
import { createProject } from '../../src/data/defaults';
import { parseCsv } from '../../src/data/import/csv';
import { validateTies } from '../../src/data/import/validate';
import { parseProject, serialiseProject } from '../../src/data/projectFile';
import {
  applyRatingChanges,
  cellState,
  layerIndex,
  pairKey,
  parseRatingInput,
  planPaste,
} from '../../src/data/ratings';
import type { Member, Project, RatingValue, Tie } from '../../src/data/schema';

const member = (id: string): Member => ({ id, display_name: id, attributes: {} });

function project(ties: Tie[]): Project {
  const p = createProject('Null and zero', '2026-09-26T00:00:00.000Z');
  p.members = ['A', 'B', 'C'].map(member);
  p.layers = p.layers.map((l) => ({ ...l, enabled: l.key === 'connection_strength' }));
  p.ties = ties;
  return p;
}
const tie = (rater: string, ratee: string, value: RatingValue): Tie => ({
  rater_id: rater,
  ratee_id: ratee,
  variable: 'connection_strength',
  value,
  wave: 1,
});

describe('types', () => {
  it('store a missing rating as null, never undefined', () => {
    expectTypeOf<Tie['value']>().toEqualTypeOf<number | string | null>();
    expectTypeOf<undefined>().not.toExtend<Tie['value']>();
    // @ts-expect-error: undefined is not a rating; use null.
    const bad: Tie = { rater_id: 'A', ratee_id: 'B', variable: 'v', value: undefined, wave: 1 };
    expect(bad.value).toBeUndefined();
  });

  it('require the value key to be present', () => {
    // @ts-expect-error: a tie without a value is not a tie.
    const bad: Tie = { rater_id: 'A', ratee_id: 'B', variable: 'v', wave: 1 };
    expect('value' in bad).toBe(false);
  });
});

describe('import', () => {
  const read = (value: string) =>
    validateTies(
      parseCsv('t.csv', `rater_id,ratee_id,variable,value\nA,B,connection_strength,${value}`),
      {
        memberIds: new Set(['A', 'B']),
        layers: project([]).layers,
      },
    ).ties[0]?.value;

  it('reads an empty cell as null and "0" as 0', () => {
    expect(read('')).toBeNull();
    expect(read('0')).toBe(0);
    expect(read('0.0')).toBe(0);
  });
});

describe('project files', () => {
  it('keep null and 0 distinct through save and load', () => {
    const p = project([tie('A', 'B', 0), tie('B', 'A', null)]);
    const loaded = parseProject(serialiseProject(p));
    expect(loaded.ties.map((t) => t.value)).toEqual([0, null]);
    expect(Object.is(loaded.ties[0]?.value, 0)).toBe(true);
  });

  it('write null as JSON null', () => {
    expect(serialiseProject(project([tie('B', 'A', null)]))).toContain('"value": null');
  });
});

describe('coverage', () => {
  it('counts 0 as rated, and null and absent as not rated, separately', () => {
    // A rates B 0 and declines C; B rates A 3 and never enters C; C enters nothing.
    const c = computeCoverage(project([tie('A', 'B', 0), tie('A', 'C', null), tie('B', 'A', 3)]));
    const [a, b, cc] = c.raters;
    expect(a).toMatchObject({ rated: 1, declined: 1, notEntered: 0, possible: 2, rate: 0.5 });
    expect(b).toMatchObject({ rated: 1, declined: 0, notEntered: 1, rate: 0.5 });
    expect(cc).toMatchObject({ rated: 0, declined: 0, notEntered: 2, rate: 0 });
    expect(c.rated).toBe(2);
    expect(c.possible).toBe(6);
    expect(c.rate).toBeCloseTo(1 / 3);
  });

  it('is fully covered when every rating is 0', () => {
    const zeros = ['A', 'B', 'C'].flatMap((r) =>
      ['A', 'B', 'C'].filter((e) => e !== r).map((e) => tie(r, e, 0)),
    );
    const c = computeCoverage(project(zeros));
    expect(c.rate).toBe(1);
    expect(c.belowThreshold).toBe(false);
  });

  it('flags coverage below the threshold', () => {
    const c = computeCoverage(project([tie('A', 'B', 0)]));
    expect(c.belowThreshold).toBe(true);
    expect(c.threshold).toBe(0.8);
  });

  it('ignores disabled layers and later waves', () => {
    const p = project([
      tie('A', 'B', 1),
      { ...tie('A', 'C', 1), variable: 'valence' },
      { ...tie('B', 'A', 1), wave: 2 },
    ]);
    expect(computeCoverage(p).rated).toBe(1);
  });

  it('is not defined when nothing can be rated', () => {
    const p = project([]);
    p.members = [member('A')];
    expect(Number.isNaN(computeCoverage(p).rate)).toBe(true);
    expect(computeCoverage(p).belowThreshold).toBe(false);
  });
});

describe('matrix cells', () => {
  it('show not rated, declined, zero and values as different states', () => {
    expect(cellState('A', 'B', undefined)).toBe('not-rated');
    expect(cellState('A', 'B', tie('A', 'B', null))).toBe('declined');
    expect(cellState('A', 'B', tie('A', 'B', 0))).toBe('zero');
    expect(cellState('A', 'B', tie('A', 'B', 3))).toBe('value');
    expect(cellState('A', 'A', tie('A', 'A', 3))).toBe('self');
  });

  it('read typed input without coercion', () => {
    const layer = project([]).layers[0];
    if (!layer) throw new Error('no layer');
    expect(parseRatingInput(layer, '0')).toEqual({ kind: 'value', value: 0 });
    expect(parseRatingInput(layer, '')).toEqual({ kind: 'clear' });
    expect(parseRatingInput(layer, '  ')).toEqual({ kind: 'clear' });
    expect(parseRatingInput(layer, 'x')).toEqual({ kind: 'error', code: 'non_numeric' });
    expect(parseRatingInput(layer, '6')).toEqual({ kind: 'error', code: 'out_of_range' });
  });

  it('clearing a cell removes the rating; entering 0 stores 0', () => {
    const now = '2026-09-26T00:00:01.000Z';
    let p = project([tie('A', 'B', 4)]);
    p = applyRatingChanges(
      p,
      'connection_strength',
      [{ rater: 'A', ratee: 'B', kind: 'set', value: 0 }],
      now,
    );
    expect(layerIndex(p.ties, 'connection_strength').get(pairKey('A', 'B'))?.value).toBe(0);
    p = applyRatingChanges(
      p,
      'connection_strength',
      [{ rater: 'A', ratee: 'B', kind: 'clear' }],
      now,
    );
    expect(layerIndex(p.ties, 'connection_strength').has(pairKey('A', 'B'))).toBe(false);
    expect(p.ties).toEqual([]);
  });

  it('never stores a self-pair', () => {
    const p = applyRatingChanges(
      project([]),
      'connection_strength',
      [{ rater: 'A', ratee: 'A', kind: 'set', value: 3 }],
      'now',
    );
    expect(p.ties).toEqual([]);
  });
});

describe('paste from a spreadsheet', () => {
  const layer = project([]).layers[0];
  if (!layer) throw new Error('no layer');
  const order = ['A', 'B', 'C'];

  it('pastes 0 as 0, clears blank cells, skips the diagonal and invalid text', () => {
    // A 3×3 block pasted at the top-left: the diagonal holds text that must be skipped.
    const plan = planPaste(layer, order, 0, 0, [
      ['x', '0', ''],
      ['2', 'y', 'nine'],
      ['7', '5', ''],
    ]);
    expect(plan.changes).toEqual([
      { rater: 'A', ratee: 'B', kind: 'set', value: 0 },
      { rater: 'A', ratee: 'C', kind: 'clear' },
      { rater: 'B', ratee: 'A', kind: 'set', value: 2 },
      { rater: 'C', ratee: 'B', kind: 'set', value: 5 },
    ]);
    expect(plan.skipped.map((s) => [s.rater, s.ratee, s.reason])).toEqual([
      ['A', 'A', 'self'],
      ['B', 'B', 'self'],
      ['B', 'C', 'non_numeric'],
      ['C', 'A', 'out_of_range'],
    ]);
    expect(plan.set).toBe(3);
    expect(plan.cleared).toBe(1);
  });

  it('counts cells that fall outside the grid', () => {
    const plan = planPaste(layer, order, 2, 1, [['1', '2', '3']]);
    expect(plan.outside).toBe(1);
    expect(plan.changes).toHaveLength(1);
  });
});
