// The insight rules (src/engine/insights.ts): each is a pure function with
// stated thresholds. These tests check each threshold at its boundary on small
// constructed inputs, and that the demo's built-in structures are found.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject } from '../../src/data/projectFile';
import { analyse } from '../../src/engine/analyse';
import { buildAnalysisInput } from '../../src/engine/input';
import {
  formalInformalGaps,
  INSIGHT_RULES,
  negativeClusters,
  peripheralMembers,
  possibleOverload,
  potentialBrokers,
  silos,
} from '../../src/engine/insights';
import {
  FI_CLASS,
  type GroupMixing,
  type NetworkMetrics,
  type NodeMetricTable,
} from '../../src/engine/types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${String(i)}`);
const table = (columns: NodeMetricTable['columns']): NodeMetricTable => ({
  columns,
  flags: {},
  omitted: null,
});
const f64 = (xs: number[]) => Float64Array.from(xs);

describe('potential brokers', () => {
  it('takes the top 10 % by betweenness whose constraint is at or below the median', () => {
    // 20 members: top 10 % is 2 members (m0, m1). m1 has high constraint, so only m0 qualifies.
    const b = f64([0.5, 0.4, 0.3, ...Array<number>(17).fill(0.01)]);
    const c = f64([0.1, 0.9, 0.1, ...Array<number>(17).fill(0.3)]);
    const o = potentialBrokers(
      ids(20),
      'composite',
      table({ betweenness: b, constraint: c }),
      true,
    );
    expect(o.status).toBe('observed');
    expect(o.observations[0]?.members).toEqual(['m0']);
    expect(o.observations[0]?.evidence.medianConstraint).toBeCloseTo(0.3);
  });

  it('includes members tied with the last one in the top share, and never betweenness 0', () => {
    const b = f64([0.2, 0.2, 0.2, 0, 0, 0, 0, 0, 0, 0]);
    const c = f64([0.1, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const o = potentialBrokers(
      ids(10),
      'composite',
      table({ betweenness: b, constraint: c }),
      false,
    );
    expect(o.observations[0]?.members).toEqual(['m0', 'm1', 'm2']);
    const none = potentialBrokers(
      ids(3),
      'composite',
      table({ betweenness: f64([0, 0, 0]), constraint: f64([1, 1, 1]) }),
      false,
    );
    expect(none.status).toBe('none');
  });

  it('is unavailable without the metrics', () => {
    expect(potentialBrokers(ids(3), 'composite', table({}), true).status).toBe('unavailable');
  });
});

describe('peripheral members', () => {
  it('needs low received strength on more than half of the layers', () => {
    // Five members, three layers. m0 is lowest on all three; m1 on one only.
    const layers = [
      { ref: 'a', node: table({ inStrength: f64([0, 0, 2, 3, 4]) }) },
      { ref: 'b', node: table({ inStrength: f64([0, 3, 2, 3, 4]) }) },
      { ref: 'c', node: table({ inStrength: f64([0, 3, 2, 3, 4]) }) },
    ];
    const o = peripheralMembers(ids(5), layers, true);
    expect(o.observations[0]?.members).toEqual(['m0']);
    expect(o.observations[0]?.evidence.layers).toBe(3);
  });

  it('ignores layers where no one receives a tie, and uses strength when symmetrised', () => {
    const empty = { ref: 'x', node: table({ strength: f64([0, 0, 0]) }) };
    expect(peripheralMembers(ids(3), [empty], false).status).toBe('unavailable');
    const one = { ref: 'y', node: table({ strength: f64([0, 1, 2, 3, 4]) }) };
    expect(peripheralMembers(ids(5), [empty, one], false).observations[0]?.members).toEqual(['m0']);
  });
});

describe('possible overload', () => {
  it('reads only advice and workflow dependency', () => {
    const o = possibleOverload(ids(3), [{ ref: 'trust', layer: 'trust', node: table({}) }], true);
    expect(o).toMatchObject({ status: 'unavailable', reason: 'layersNotEnabled' });
  });

  it('needs the 90th percentile and twice the median', () => {
    // Median 2; 90th percentile 7.3 → m9 (10) qualifies; m8 (5) does not.
    const d = f64([1, 1, 2, 2, 2, 2, 2, 3, 5, 10]);
    const o = possibleOverload(
      ids(10),
      [{ ref: 'advice', layer: 'advice', node: table({ inDegree: d }) }],
      true,
    );
    expect(o.observations[0]?.members).toEqual(['m9']);
    expect(o.observations[0]?.evidence).toMatchObject({ highest: 10, median: 2 });
    // Everyone equal: nobody stands out.
    const flat = possibleOverload(
      ids(4),
      [{ ref: 'advice', layer: 'advice', node: table({ inDegree: f64([3, 3, 3, 3]) }) }],
      true,
    );
    expect(flat.status).toBe('none');
  });
});

describe('silos', () => {
  const mixing = (ei: number, size = 4): GroupMixing => ({
    groups: ['A', 'B'],
    excluded: 0,
    internal: 10,
    external: 2,
    ei: -0.6,
    perGroup: [
      { group: 'A', size, internal: 10, external: 2, ei },
      { group: 'B', size: 4, internal: 4, external: 6, ei: 0.2 },
    ],
    density: new Float64Array(4),
  });
  const network = (m: GroupMixing) => ({ mixing: { team: m } }) as unknown as NetworkMetrics;
  const attributes = {
    team: { categories: ['A', 'B'], values: ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'] },
  };

  it('flags a group at E-I −0.5 or lower on any layer, quoting the lowest', () => {
    const o = silos(
      ids(8),
      [
        { ref: 'composite', network: network(mixing(-0.5)) },
        { ref: 'informal', network: network(mixing(-0.8)) },
      ],
      attributes,
    );
    expect(o.observations).toHaveLength(1);
    expect(o.observations[0]).toMatchObject({
      ref: 'informal',
      group: { attribute: 'team', value: 'A' },
      members: ['m0', 'm1', 'm2', 'm3'],
      evidence: { ei: -0.8, layers: 2 },
    });
  });

  it('ignores E-I just above the threshold and groups under three members', () => {
    expect(silos(ids(8), [{ ref: 'c', network: network(mixing(-0.49)) }], attributes).status).toBe(
      'none',
    );
    expect(silos(ids(8), [{ ref: 'c', network: network(mixing(-1, 2)) }], attributes).status).toBe(
      'none',
    );
    expect(silos(ids(8), [{ ref: 'c', network: network(mixing(-1)) }], {}).status).toBe(
      'unavailable',
    );
  });
});

describe('negative clusters', () => {
  it('joins pairs negative in both directions and needs three members', () => {
    const n = 4;
    const s = new Float64Array(n * n).fill(NaN);
    const set = (i: number, j: number, v: number) => {
      s[i * n + j] = v;
    };
    set(0, 1, -0.5);
    set(1, 0, -1);
    set(1, 2, -0.3);
    set(2, 1, -0.3);
    set(2, 3, -1); // one direction only: not reciprocated
    set(3, 2, 0.5);
    const o = negativeClusters(ids(4), new Map([['valence', s]]), 'composite');
    expect(o.observations[0]).toMatchObject({
      members: ['m0', 'm1', 'm2'],
      evidence: { size: 3, pairs: 2 },
      ref: 'valence-',
    });
    set(1, 2, NaN);
    expect(negativeClusters(ids(4), new Map([['valence', s]]), 'composite').status).toBe('none');
    expect(negativeClusters(ids(4), new Map(), 'composite').status).toBe('unavailable');
  });
});

describe('formal–informal gaps', () => {
  it('compares pairs of groups against the share and count thresholds', () => {
    // Two teams of 3. Between them (9 unordered pairs): 6 formal only, 3 both → 67 %, 6 pairs.
    const n = 6;
    const classes = new Uint8Array(n * n).fill(FI_CLASS.neither);
    const mark = (i: number, j: number, c: number) => {
      classes[i * n + j] = c;
      classes[j * n + i] = c;
    };
    let k = 0;
    for (const i of [0, 1, 2])
      for (const j of [3, 4, 5]) mark(i, j, k++ < 6 ? FI_CLASS.formalOnly : FI_CLASS.both);
    const fi = {
      formal: 'formal_collaboration',
      informal: 'informal_collaboration',
      counts: { formalOnly: 6, informalOnly: 0, both: 3, neither: 0, notClassified: 0 },
      classes,
    };
    const attributes = { team: { categories: ['A', 'B'], values: ['A', 'A', 'A', 'B', 'B', 'B'] } };
    const [formal, informal] = formalInformalGaps(ids(6), fi, false, attributes);
    expect(formal?.observations[0]).toMatchObject({
      group: { value: 'A', other: 'B' },
      evidence: { pairs: 6, total: 9 },
      view: { filters: [{ key: 'team', values: ['A', 'B'] }], layout: 'grouped' },
    });
    expect(informal?.status).toBe('none');
    expect(INSIGHT_RULES.formalInformal.minPairs).toBe(5);
    // Without the two layers the rules are not applied.
    expect(formalInformalGaps(ids(6), null, false, attributes).map((o) => o.status)).toEqual([
      'unavailable',
      'unavailable',
    ]);
  });
});

describe('the demo', () => {
  const project = parseProject(
    readFileSync(join(import.meta.dirname, '..', '..', 'src', 'demo', 'demo.ona.json'), 'utf8'),
  );

  it.each(['directed', 'symmetrised'] as const)(
    'finds the structures built into it (%s view)',
    async (view) => {
      const result = await analyse(
        buildAnalysisInput(
          project,
          { view, symmetrise: 'mean', weights: {}, signedTreatment: {} },
          view,
        ),
      );
      const by = Object.fromEntries(result.insights.map((o) => [o.rule, o]));
      expect(by.brokers?.observations[0]?.members).toContain('OPE04');
      expect(by.silo?.observations.map((o) => o.group?.value)).toEqual(['Finance']);
      expect(by.negativeCluster?.observations[0]?.members.length).toBeGreaterThanOrEqual(3);
      expect(by.formalOnly?.observations[0]?.group).toMatchObject({
        value: 'Product',
        other: 'Sales',
      });
      expect(by.informalOnly?.observations[0]?.group).toMatchObject({
        value: 'People',
        other: 'Product',
      });
      expect(by.overload).toMatchObject({ status: 'unavailable', reason: 'layersNotEnabled' });
    },
  );
});
