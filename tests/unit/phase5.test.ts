// Phase 5 logic that does not need a browser: subgroup density, layer overlap,
// presets, layouts, the ego view, the lasso, the worker's reuse of results
// when only weights change, and the CSV export.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject } from '../../src/data/projectFile';
import { analyse } from '../../src/engine/analyse';
import { createEngineHandler } from '../../src/engine/handler';
import { buildAnalysisInput } from '../../src/engine/input';
import { subgroupDensity, tieOverlap } from '../../src/engine/metrics/subgroup';
import type { EngineResponse } from '../../src/engine/protocol';
import type { AnalysisResult } from '../../src/engine/types';
import { insidePolygon } from '../../src/ui/map/scene';
import {
  ForceLayout,
  cubicBezier,
  hierarchyParents,
  parseEasing,
  targetPositions,
} from '../../src/ui/map/layout';
import { egoSet } from '../../src/ui/map/model';
import { rankInterval } from '../../src/ui/map/rank';
import { effectiveWeights, initialWeightState, weightsKey } from '../../src/ui/state/presets';
import { parseDuration } from '../../src/ui/durations';
import { heatClass } from '../../src/ui/views/AdjacencyView';
import { csvField, toCsv } from '../../src/ui/views/csv';

const demo = parseProject(
  readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
);

/** n × n weights from a list of ties; everything else rated 0. */
function weights(n: number, ties: [number, number, number][]): Float64Array {
  const w = new Float64Array(n * n);
  for (const [i, j, v] of ties) w[i * n + j] = v;
  return w;
}

describe('subgroup density', () => {
  // 0-1-2 is a closed triangle (both directions); 2→3 and 4→0 reach outside it.
  const n = 5;
  const w = weights(n, [
    [0, 1, 1],
    [1, 0, 1],
    [1, 2, 0.5],
    [2, 1, 0.5],
    [0, 2, 1],
    [2, 0, 1],
    [2, 3, 1],
    [4, 0, 0.2],
  ]);

  it('counts ordered pairs in the directed view', () => {
    const d = subgroupDensity(w, n, true, [0, 1, 2]);
    expect(d).toMatchObject({ size: 3, others: 2, internalTies: 6, internalPossible: 6 });
    expect(d.internal).toBe(1);
    expect(d.externalTies).toBe(2);
    expect(d.externalPossible).toBe(12);
    expect(d.external).toBeCloseTo(2 / 12, 12);
    expect(d.ei).toBeCloseTo((2 - 6) / 8, 12);
  });

  it('counts unordered pairs in the symmetrised view and can limit the rest', () => {
    const sym = weights(n, [
      [0, 1, 1],
      [1, 0, 1],
      [2, 3, 1],
      [3, 2, 1],
    ]);
    const d = subgroupDensity(sym, n, false, [0, 1, 2]);
    expect(d).toMatchObject({
      internalTies: 1,
      internalPossible: 3,
      externalTies: 1,
      externalPossible: 6,
    });
    const limited = subgroupDensity(sym, n, false, [0, 1, 2], [4]);
    expect(limited).toMatchObject({ others: 1, externalTies: 0, externalPossible: 3 });
  });

  it('treats not rated (NaN) as no tie and leaves densities undefined when they cannot be formed', () => {
    const w2 = new Float64Array(4).fill(NaN);
    const d = subgroupDensity(w2, 2, true, [0]);
    expect(d.internal).toBeNaN();
    expect(d.externalTies).toBe(0);
    expect(d.ei).toBeNaN();
  });
});

describe('tie overlap between two layers', () => {
  it('classifies pairs and gives the Jaccard share', () => {
    const n = 3;
    const a = weights(n, [
      [0, 1, 1],
      [1, 2, 1],
    ]);
    const b = weights(n, [
      [0, 1, 0.4],
      [2, 0, 1],
    ]);
    const o = tieOverlap(a, b, n, true);
    expect([o.both, o.firstOnly, o.secondOnly]).toEqual([1, 1, 1]);
    expect(o.jaccard).toBeCloseTo(1 / 3, 12);
    expect(o.classes[0 * n + 1]).toBe(3);
    expect(o.classes[1 * n + 2]).toBe(1);
    expect(o.classes[2 * n + 0]).toBe(2);
  });
});

describe('presets', () => {
  it('Custom uses each layer’s default weight until a slider moves', () => {
    const w = effectiveWeights(demo, initialWeightState());
    expect(Object.values(w.weights).every((v) => v === 1)).toBe(true);
    expect(w.signedTreatment.valence).toBe('positive');
  });

  it('a preset leaves unlisted layers out with weight 0', () => {
    const w = effectiveWeights(demo, { ...initialWeightState(), preset: 'formal' });
    expect(w.weights).toEqual({
      connection_strength: 0,
      valence: 0,
      informal_collaboration: 0,
      formal_collaboration: 0.4,
    });
    const health = effectiveWeights(demo, { ...initialWeightState(), preset: 'health' });
    expect(health.signedTreatment.valence).toBe('multiplier');
    expect(health.weights.connection_strength).toBe(0.2);
    const informal = effectiveWeights(demo, { ...initialWeightState(), preset: 'informal' });
    expect(weightsKey(informal)).not.toBe(weightsKey(w));
  });
});

describe('layouts', () => {
  it('breaks manager cycles and ignores unknown or self managers', () => {
    const parent = hierarchyParents(
      ['b', 'c', 'a', 'x', 'd', null],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    // a → b → c → a is a loop: one link is cut, so every chain ends.
    for (let i = 0; i < 3; i++) {
      let v = i;
      let steps = 0;
      while (v >= 0 && steps < 10) {
        v = parent[v] as number;
        steps += 1;
      }
      expect(steps).toBeLessThan(10);
    }
    expect(parent[3]).toBe(-1); // unknown manager
    expect(parent[4]).toBe(3);
    expect(parent[5]).toBe(-1);
  });

  it('places managers above their reports and stacks leaf reports in a column', () => {
    const names = ['Root', 'A', 'B', 'C', 'D', 'E'];
    // Root manages A; A manages B, C, D, E (all leaves).
    const t = targetPositions({ kind: 'hierarchy', parent: [-1, 0, 1, 1, 1, 1], names }, 6);
    if (!t) throw new Error('no targets');
    expect(t.y[0]).toBeLessThan(t.y[1] as number);
    for (const k of [2, 3, 4, 5]) {
      expect(t.column[k]).toBe(true);
      expect(t.y[k]).toBeGreaterThan(t.y[1] as number);
      expect(t.x[k]).toBe(t.x[2]);
    }
  });

  it('puts each group on one arc of the circle', () => {
    const group = [0, 1, 0, 1, 2, 2];
    const t = targetPositions(
      { kind: 'circular', group, groups: ['a', 'b', 'c'], names: ['p', 'q', 'r', 's', 't', 'u'] },
      6,
    );
    if (!t) throw new Error('no targets');
    const angle = (i: number) => Math.atan2(t.y[i] as number, t.x[i] as number);
    const r = Math.hypot(t.x[0] as number, t.y[0] as number);
    for (let i = 0; i < 6; i++)
      expect(Math.hypot(t.x[i] as number, t.y[i] as number)).toBeCloseTo(r, 9);
    // Members of one group are neighbours on the circle.
    const order = [0, 1, 2, 3, 4, 5].sort(
      (a, b) =>
        ((angle(a) + 2 * Math.PI + Math.PI / 2) % (2 * Math.PI)) -
        ((angle(b) + 2 * Math.PI + Math.PI / 2) % (2 * Math.PI)),
    );
    expect(order.map((i) => group[i])).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('interpolates from the old positions and ends on the settled ones', () => {
    const layout = new ForceLayout();
    const w = weights(4, [
      [0, 1, 1],
      [2, 3, 1],
    ]);
    layout.update('a', 4, w, [4, 4, 4, 4]);
    const before = layout.positions.map((p) => ({ ...p }));
    layout.update('b', 4, w, [4, 4, 4, 4], {
      kind: 'circular',
      group: [0, 0, 1, 1],
      groups: ['x', 'y'],
      names: ['a', 'b', 'c', 'd'],
    });
    layout.animateFrom(before, 600, (t) => t, 0);
    expect(layout.animating).toBe(true);
    layout.advance(300);
    const mid = layout.positions[0] as { x: number; y: number };
    const end = layout.settled[0] as { x: number; y: number };
    const start = before[0] as { x: number; y: number };
    expect(mid.x).toBeCloseTo((start.x + end.x) / 2, 6);
    expect(layout.advance(600)).toBe(false);
    expect(layout.positions[0]).toEqual(layout.settled[0]);
  });

  it('skips the animation when it has no duration (reduced motion)', () => {
    const layout = new ForceLayout();
    layout.update('a', 2, undefined, [4, 4]);
    const before = layout.positions.map((p) => ({ x: p.x + 50, y: p.y }));
    layout.animateFrom(before, 0, (t) => t, 0);
    expect(layout.animating).toBe(false);
  });

  it('reads the easing token', () => {
    const ease = parseEasing('cubic-bezier(0.4, 0, 0.2, 1)');
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(cubicBezier(0.4, 0, 0.2, 1)(0.5), 9);
    expect(ease(0.5)).toBeGreaterThan(0.5);
    expect(parseEasing('linear')(0.3)).toBe(0.3);
  });
});

describe('ego view and lasso', () => {
  it('takes the member and everyone within the chosen steps', () => {
    const neighbours = [[1], [0, 2], [1, 3], [2], []];
    expect([...egoSet(neighbours, 0, 1)].sort()).toEqual([0, 1]);
    expect([...egoSet(neighbours, 0, 2)].sort()).toEqual([0, 1, 2]);
    expect([...egoSet(neighbours, 4, 2)]).toEqual([4]);
  });

  it('selects points inside the drawn polygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(insidePolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(insidePolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});

describe('the worker reuses results when only weights change', () => {
  it('gives the same result as a full analysis', async () => {
    const out: EngineResponse[] = [];
    const handle = createEngineHandler((m) => out.push(m));
    const input = (weights: Record<string, number>, key: string) => ({
      ...buildAnalysisInput(
        demo,
        { view: 'symmetrised', symmetrise: 'mean', weights, signedTreatment: {} },
        key,
      ),
      baseKey: 'same data',
    });
    await handle({ id: 1, kind: 'analyse', input: input({}, 'first') });
    const heavy = { connection_strength: 0.1, formal_collaboration: 0.9 };
    await handle({ id: 2, kind: 'analyse', input: input(heavy, 'second') });
    const reused = (
      out.find((m) => m.id === 2 && m.kind === 'analysis') as { result: AnalysisResult }
    ).result;
    const fresh = await analyse(
      buildAnalysisInput(
        demo,
        { view: 'symmetrised', symmetrise: 'mean', weights: heavy, signedTreatment: {} },
        'fresh',
      ),
    );
    // Every layer's results are the first run's own objects (reused); the composite is new.
    const first = (
      out.find((m) => m.id === 1 && m.kind === 'analysis') as { result: AnalysisResult }
    ).result;
    expect(reused.refs.connection_strength).toBe(first.refs.connection_strength);
    expect(reused.refs.composite).not.toBe(first.refs.composite);
    expect(reused.refOrder).toEqual(fresh.refOrder);
    for (const ref of fresh.refOrder) {
      const a = reused.refs[ref];
      const b = fresh.refs[ref];
      expect(Array.from(a?.weights ?? [])).toEqual(Array.from(b?.weights ?? []));
      expect(Array.from(a?.node.columns.betweenness ?? [])).toEqual(
        Array.from(b?.node.columns.betweenness ?? []),
      );
      expect(a?.communities?.modularity).toBe(b?.communities?.modularity);
    }
    expect(reused.composite).toEqual(fresh.composite);
    expect(reused.multiplex?.formalInformal?.counts).toEqual(
      fresh.multiplex?.formalInformal?.counts,
    );
  });
});

describe('small helpers', () => {
  it('reads motion tokens in either unit (the build minifies 600ms to .6s)', () => {
    expect(parseDuration('600ms')).toBe(600);
    expect(parseDuration('.6s')).toBe(600);
    expect(parseDuration(' 0ms')).toBe(0);
    expect(parseDuration('')).toBe(0);
  });

  it('rounds rank intervals outwards', () => {
    expect(rankInterval(2.3, 5.6)).toBe('2–6');
    expect(rankInterval(3, 3)).toBe('3');
    expect(rankInterval(NaN, 2)).toBe('–');
  });

  it('heat-codes weights with not rated and zero kept apart', () => {
    expect(heatClass(NaN)).toBe('adjacency__cell--not-rated');
    expect(heatClass(0)).toBe('shade-0');
    expect(heatClass(0.01)).toBe('shade-1');
    expect(heatClass(1)).toBe('shade-5');
  });

  it('quotes CSV fields only when needed', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(
      toCsv([
        ['a', 'b'],
        ['1', ''],
      ]),
    ).toBe('a,b\r\n1,\r\n');
  });
});
