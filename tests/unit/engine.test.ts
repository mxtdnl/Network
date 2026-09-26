// Engine behaviour that has no NetworkX counterpart: the negative-weight guard,
// input building (null → NaN), aggregation rules, the composite formula,
// resilience, the bootstrap, and the worker message interface.

import { beforeEach, describe, expect, it } from 'vitest';
import { computeCoverage } from '../../src/data/coverage';
import { createProject } from '../../src/data/defaults';
import { parseProject } from '../../src/data/projectFile';
import type { Member, Project, Tie } from '../../src/data/schema';
import { combine, reciprocity, symmetrise } from '../../src/engine/aggregate';
import { analyse, prepare, runBootstrap, runPath, runResilience } from '../../src/engine/analyse';
import { compositeFormula, compositeMatrix } from '../../src/engine/composite';
import {
  denseGraph,
  NegativeWeightError,
  pathGraph,
  pathGuardAudit,
  resetPathGuardAudit,
} from '../../src/engine/graphs';
import { createEngineHandler } from '../../src/engine/handler';
import { buildAnalysisInput, type AnalysisOptions } from '../../src/engine/input';
import { bootstrap, percentile, rankDescending } from '../../src/engine/metrics/bootstrap';
import type { EngineRequest, EngineResponse } from '../../src/engine/protocol';
import { CancelledError } from '../../src/engine/schedule';
import type { AnalysisInput, EngineLayer, EngineSettings } from '../../src/engine/types';
import {
  EngineCancelledError,
  EngineClient,
  EngineError,
  type WorkerLike,
} from '../../src/ui/engineClient';
import { demoText } from './engineFixtures';

const OPTIONS: AnalysisOptions = {
  view: 'directed',
  symmetrise: 'mean',
  weights: {},
  signedTreatment: {},
};
const demo = parseProject(demoText);
const demoInput = (over: Partial<AnalysisOptions> = {}, key = 'demo') =>
  buildAnalysisInput(demo, { ...OPTIONS, ...over }, key);

const layer = (key: string, over: Partial<EngineLayer> = {}): EngineLayer => ({
  key,
  label: key,
  min: 0,
  max: 5,
  signed: false,
  defaultWeight: 1,
  ...over,
});
const settings = (over: Partial<EngineSettings> = {}): EngineSettings => ({
  view: 'directed',
  symmetrise: 'mean',
  weights: {},
  signedTreatment: {},
  seed: 1,
  ...over,
});
/** n × n tensor from { 'i,j': value }, NaN elsewhere. */
function tensor(n: number, cells: Record<string, number>): Float64Array {
  const m = new Float64Array(n * n).fill(NaN);
  for (const [k, v] of Object.entries(cells)) {
    const [i, j] = k.split(',').map(Number) as [number, number];
    m[i * n + j] = v;
  }
  return m;
}

// ------------------------------------------------------ negative weights

describe('negative weights never reach path algorithms (spec §6)', () => {
  beforeEach(resetPathGuardAudit);

  it('the path gate refuses a negative weight', () => {
    const g = denseGraph(Float64Array.from([0, 1, -0.5, 0]), 2, true);
    expect(() => pathGraph(g)).toThrow(NegativeWeightError);
    expect(() => pathGraph({ ...g, w: Float64Array.from([0, NaN, 1, 0]) })).toThrow(
      NegativeWeightError,
    );
  });

  it('a full analysis of the demo, which has negative valence, sends only non-negative weights', async () => {
    const valence = demoInput().layers.findIndex((l) => l.key === 'valence');
    expect(Array.from(demoInput().ratings[valence] ?? []).some((v) => v < 0)).toBe(true);
    for (const view of ['directed', 'symmetrised'] as const) {
      for (const symmetriseRule of ['mean', 'min', 'max'] as const) {
        for (const treatment of ['positive', 'filterNegative', 'multiplier'] as const) {
          const input = demoInput({
            view,
            symmetrise: symmetriseRule,
            signedTreatment: { valence: treatment },
          });
          const p = prepare(input);
          await analyse(input);
          runResilience(p, 'composite', ['OPE04']);
          await runBootstrap(p, {
            ref: 'valence+',
            metric: 'betweenness',
            replicates: 2,
            dropFraction: 0.1,
            seed: 1,
          });
        }
      }
    }
    expect(pathGuardAudit.graphs).toBeGreaterThan(0);
    expect(pathGuardAudit.minWeight).toBeGreaterThan(0);
  });

  it('negative sub-layers get strength, degree and clustering only (plan Q11)', async () => {
    const result = await analyse(demoInput());
    const neg = result.refs['valence-'];
    expect(Object.keys(neg?.node.columns ?? {}).sort()).toEqual(
      ['clustering', 'inDegree', 'inStrength', 'outDegree', 'outStrength'].sort(),
    );
    expect(neg?.node.omitted?.metrics).toContain('betweenness');
    const p = prepare(demoInput());
    expect(() => runResilience(p, 'valence-', [])).toThrow(/negative sub-layer/);
    await expect(
      runBootstrap(p, {
        ref: 'valence-',
        metric: 'betweenness',
        replicates: 1,
        dropFraction: 0.1,
        seed: 1,
      }),
    ).rejects.toThrow(/negative sub-layer/);
    await expect(
      runBootstrap(p, {
        ref: 'valence-',
        metric: 'inStrength',
        replicates: 1,
        dropFraction: 0.1,
        seed: 1,
      }),
    ).resolves.toBeDefined();
  });
});

// ------------------------------------------------------------- input

describe('input and aggregation', () => {
  const member = (id: string): Member => ({ id, display_name: id, attributes: { team: 'X' } });
  const tie = (rater: string, ratee: string, value: number | null): Tie => ({
    rater_id: rater,
    ratee_id: ratee,
    variable: 'connection_strength',
    value,
    wave: 1,
  });
  function project(ties: Tie[]): Project {
    const p = createProject('t', '2026-09-26T00:00:00.000Z');
    p.members = ['A', 'B', 'C'].map(member);
    p.layers = p.layers.map((l) => ({ ...l, enabled: l.key === 'connection_strength' }));
    p.ties = ties;
    return p;
  }

  it('turns null and absent ratings into NaN and keeps 0 as 0', () => {
    const input = buildAnalysisInput(
      project([tie('A', 'B', 0), tie('A', 'C', null)]),
      OPTIONS,
      'k',
    );
    const r = input.ratings[0];
    expect(r?.[0 * 3 + 1]).toBe(0);
    expect(r?.[0 * 3 + 2]).toBeNaN();
    expect(r?.[1 * 3 + 0]).toBeNaN();
  });

  it('a rated 0 and a missing rating give different symmetrised weights and composites', () => {
    const zero = prepare(
      buildAnalysisInput(
        project([tie('A', 'B', 5), tie('B', 'A', 0)]),
        { ...OPTIONS, view: 'symmetrised' },
        'z',
      ),
    );
    const missing = prepare(
      buildAnalysisInput(project([tie('A', 'B', 5)]), { ...OPTIONS, view: 'symmetrised' }, 'm'),
    );
    const w = (p: ReturnType<typeof prepare>, ref: string) =>
      p.refs.find((x) => x.ref === ref)?.view[0 * 3 + 1];
    expect(w(zero, 'connection_strength')).toBe(0.5);
    expect(w(missing, 'connection_strength')).toBe(1);
    expect(w(zero, 'composite')).toBe(0.5);
    expect(w(missing, 'composite')).toBe(1);
    // B → A: rated 0 is a composite of 0; not rated is missing.
    const d = (p: ReturnType<typeof prepare>) =>
      p.refs.find((x) => x.ref === 'composite')?.directed[1 * 3 + 0];
    expect(d(zero)).toBe(0);
    expect(d(missing)).toBeNaN();
  });

  it('symmetrises by mean, min or max and uses the one rated direction (plan Q3)', () => {
    expect([combine(0.2, 0.8, 'mean'), combine(0.2, 0.8, 'min'), combine(0.2, 0.8, 'max')]).toEqual(
      [0.5, 0.2, 0.8],
    );
    expect(combine(NaN, 0.4, 'min')).toBe(0.4);
    expect(combine(NaN, NaN, 'max')).toBeNaN();
    const s = symmetrise(tensor(2, { '0,1': 1 }), 2, 'min');
    expect([s[1], s[2]]).toEqual([1, 1]);
  });

  it('reports reciprocity from the directed ties in both views', async () => {
    expect(reciprocity(tensor(3, { '0,1': 1, '1,0': 1, '1,2': 1 }), 3)).toEqual({
      overall: 2 / 3,
      dyad: 0.5,
      mutualDyads: 1,
      asymmetricDyads: 1,
    });
    const d = await analyse(demoInput());
    const s = await analyse(demoInput({ view: 'symmetrised' }));
    expect(s.refs.connection_strength?.network.reciprocity).toEqual(
      d.refs.connection_strength?.network.reciprocity,
    );
  });

  it('flags a signed dyad whose directions disagree by the symmetrisation rule (plan Q4)', async () => {
    const input: AnalysisInput = {
      inputKey: 'q4',
      memberIds: ['a', 'b', 'c'],
      attributes: {},
      layers: [layer('v', { min: -3, max: 3, signed: true })],
      ratings: [tensor(3, { '0,1': 3, '1,0': -1, '1,2': 3, '0,2': 3 })],
      settings: settings({ view: 'symmetrised' }),
    };
    const t = async (rule: 'mean' | 'min' | 'max') =>
      (await analyse({ ...input, settings: settings({ view: 'symmetrised', symmetrise: rule }) }))
        .signed.v?.triads;
    expect((await t('mean'))?.ppp).toBe(1); // (1 − 1/3)/2 > 0
    expect((await t('min'))?.ppn).toBe(1);
    expect((await t('max'))?.ppp).toBe(1);
  });
});

// ------------------------------------------------------------ composite

describe('composite (spec §7)', () => {
  const layers = [
    layer('a'),
    layer('b'),
    layer('v', { min: -3, max: 3, signed: true, label: 'Valence' }),
  ];

  it('returns the formula as a structure whose weights sum to 1', () => {
    const f = compositeFormula(layers, settings({ weights: { a: 3, b: 1, v: 0 } }));
    expect(f?.terms.map((t) => [t.layer, t.weight, t.transform])).toEqual([
      ['a', 0.75, 'rescale'],
      ['b', 0.25, 'rescale'],
    ]);
    expect(f?.excluded).toEqual(['v']);
    expect(f?.notation).toBe('C = 0.75·r(a) + 0.25·r(b); C ≤ 1');
    expect(compositeFormula(layers, settings({ weights: { a: 0, b: 0, v: 0 } }))).toBeNull();
  });

  it('computes what the formula states, renormalising over rated layers (plan Q2)', () => {
    const ratings = [
      tensor(2, { '0,1': 5, '1,0': 5 }),
      tensor(2, { '0,1': 0 }),
      tensor(2, { '0,1': 3, '1,0': -3 }),
    ];
    const f = compositeFormula(layers, settings({ weights: { a: 1, b: 1, v: 2 } }));
    if (!f) throw new Error('no formula');
    const c = compositeMatrix(f, layers, ratings, 2);
    // 0→1: (0.25·1 + 0.25·0 + 0.5·1) / 1; 1→0: b missing, v positive part 0 → (0.25·1 + 0.5·0)/0.75.
    expect(c[1]).toBeCloseTo(0.75, 15);
    expect(c[2]).toBeCloseTo(1 / 3, 15);
  });

  it('applies the three signed treatments', () => {
    const ratings = [
      tensor(2, { '0,1': 4, '1,0': 4 }),
      tensor(2, { '0,1': 4, '1,0': 4 }),
      tensor(2, { '0,1': 3, '1,0': -3 }),
    ];
    const run = (t: 'positive' | 'filterNegative' | 'multiplier') => {
      const f = compositeFormula(layers, settings({ signedTreatment: { v: t } }));
      if (!f) throw new Error('no formula');
      return { f, c: compositeMatrix(f, layers, ratings, 2) };
    };
    const filter = run('filterNegative');
    expect([filter.c[1], filter.c[2]]).toEqual([0.8, 0]);
    expect(filter.f.notation).toBe('C = 0.5·r(a) + 0.5·r(b); C = 0 where Valence < 0; C ≤ 1');
    const mult = run('multiplier');
    expect(mult.c[1]).toBe(1); // 0.8 × 1.5 = 1.2, capped at 1
    expect(mult.c[2]).toBeCloseTo(0.4, 15); // 0.8 × 0.5
    expect(mult.f.notation).toBe('C = (0.5·r(a) + 0.5·r(b)) × (1 + 0.5·s(Valence)); C ≤ 1');
    const pos = run('positive');
    expect(pos.f.terms.find((t) => t.layer === 'v')?.transform).toBe('positivePart');
  });

  it('the analysis reports the formula it evaluated', async () => {
    const r = await analyse(demoInput());
    expect(r.composite?.terms.map((t) => t.weight)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(r.refOrder.at(-1)).toBe('composite');
  });
});

// ------------------------------------------------------ coverage and paths

describe('coverage and shortest paths', () => {
  it('passes data coverage through to the result', async () => {
    const r = await analyse(demoInput());
    expect(r.coverage).toEqual(computeCoverage(demo));
    expect(r.coverage?.declined).toBeGreaterThan(0);
  });

  it('returns a deterministic shortest path, or null when there is none', () => {
    // a → b → d and a → c → d are equally short; the lower-index route is chosen.
    const input: AnalysisInput = {
      inputKey: 'p',
      memberIds: ['a', 'b', 'c', 'd', 'e'],
      attributes: {},
      layers: [layer('s')],
      ratings: [tensor(5, { '0,1': 5, '1,3': 5, '0,2': 5, '2,3': 5, '0,3': 1 })],
      settings: settings(),
    };
    const p = prepare(input);
    expect(runPath(p, 's', 'a', 'd')).toEqual({
      ref: 's',
      members: ['a', 'b', 'd'],
      distance: 2,
      hops: 2,
      shortestPaths: 2,
    });
    expect(runPath(p, 's', 'd', 'a')).toBeNull();
    expect(runPath(p, 's', 'a', 'e')).toBeNull();
    expect(() => runPath(prepare(demoInput()), 'valence-', 'FIN01', 'FIN02')).toThrow(
      /negative sub-layer/,
    );
  });
});

// ---------------------------------------------------------- resilience

describe('resilience', () => {
  it('reports the change after removing the broker', async () => {
    const p = prepare(demoInput({ view: 'symmetrised' }));
    const res = runResilience(p, 'connection_strength', ['OPE04']);
    expect(res.removed).toEqual(['OPE04']);
    expect(res.before.members).toBe(40);
    expect(res.after.members).toBe(39);
    expect(res.change.reachability).toBeCloseTo(
      res.after.reachability - res.before.reachability,
      15,
    );
    await Promise.resolve();
  });

  it('removing a star centre disconnects every leaf', () => {
    const n = 5;
    const cells: Record<string, number> = {};
    for (let i = 1; i < n; i++) {
      cells[`0,${String(i)}`] = 5;
      cells[`${String(i)},0`] = 5;
    }
    const input: AnalysisInput = {
      inputKey: 'star',
      memberIds: ['c', 'l1', 'l2', 'l3', 'l4'],
      attributes: {},
      layers: [layer('s')],
      ratings: [tensor(n, cells)],
      settings: settings({ view: 'symmetrised' }),
    };
    const res = runResilience(prepare(input), 's', ['c']);
    expect(res.before.reachability).toBe(1);
    expect(res.after.reachability).toBe(0);
    expect(res.after.components.connected).toBe(4);
    expect(res.after.averageDistance).toBeNaN();
    expect(res.change.components).toBe(3);
  });
});

// ------------------------------------------------------------ bootstrap

describe('stability bootstrap', () => {
  const opts = {
    ref: 'composite',
    metric: 'betweenness',
    replicates: 20,
    dropFraction: 0.1,
    seed: 7,
  } as const;

  it('ranks descending with shared ranks for ties and percentiles like numpy', () => {
    expect(Array.from(rankDescending(Float64Array.from([1, 3, 3, NaN, 0])).ranks)).toEqual([
      3,
      1.5,
      1.5,
      NaN,
      4,
    ]);
    expect(percentile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });

  it('is deterministic for a seed and returns intervals around the observed rank', async () => {
    const p = prepare(demoInput());
    const a = await runBootstrap(p, opts);
    const b = await runBootstrap(p, opts);
    expect(a).toEqual(b);
    expect(a.dropped).toBe(4);
    for (let i = 0; i < 40; i++) {
      expect(a.rankLow[i]).toBeLessThanOrEqual(a.rankHigh[i] as number);
      expect(a.rankLow[i]).toBeGreaterThanOrEqual(1);
      expect(a.rankHigh[i]).toBeLessThanOrEqual(40);
    }
    const c = await runBootstrap(p, { ...opts, seed: 8 });
    expect(Array.from(c.rankLow)).not.toEqual(Array.from(a.rankLow));
  });

  it('a star centre always ranks first', async () => {
    const n = 12;
    const w = new Float64Array(n * n);
    for (let i = 1; i < n; i++) {
      w[i] = 1;
      w[i * n] = 1;
    }
    const r = await bootstrap(denseGraph(w, n, false), {
      ...opts,
      replicates: 50,
      dropFraction: 0.2,
    });
    // The centre is dropped in some replicates; whenever it is kept it ranks first.
    expect(r.rankLow[0]).toBe(1);
    expect(r.rankHigh[0]).toBe(1);
    expect(r.observedRank[0]).toBe(1);
  });

  it('reports progress and can be cancelled', async () => {
    const p = prepare(demoInput());
    const progress: number[] = [];
    await runBootstrap(p, { ...opts, replicates: 5 }, { onProgress: (f) => progress.push(f) });
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toHaveLength(6);

    const controller = new AbortController();
    const seen: number[] = [];
    const run = runBootstrap(
      p,
      { ...opts, replicates: 1000 },
      {
        signal: controller.signal,
        onProgress: (f) => {
          seen.push(f);
          if (seen.length === 3) controller.abort();
        },
      },
    );
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(seen.at(-1)).toBeLessThan(1);
  });
});

// ------------------------------------------------ worker message interface

function harness() {
  const out: EngineResponse[] = [];
  const handle = createEngineHandler((m) => out.push(m));
  return { out, handle };
}

describe('engine worker handler', () => {
  it('answers analyse with progress then the result', async () => {
    const { out, handle } = harness();
    await handle({ id: 1, kind: 'analyse', input: demoInput() });
    const kinds = out.map((m) => m.kind);
    expect(kinds.at(-1)).toBe('analysis');
    expect(kinds.filter((k) => k === 'progress').length).toBeGreaterThan(3);
    const last = out.at(-1);
    expect(last?.kind === 'analysis' && last.result.inputKey).toBe('demo');
  });

  it('cancels a running analysis', async () => {
    const { out, handle } = harness();
    const running = handle({ id: 1, kind: 'analyse', input: demoInput() });
    await handle({ id: 2, kind: 'cancel', target: 1 });
    await running;
    expect(out.at(-1)).toEqual({ id: 1, kind: 'cancelled' });
  });

  it('runs resilience and bootstrap against the last analysis, and refuses a stale key', async () => {
    const { out, handle } = harness();
    await handle({ id: 1, kind: 'analyse', input: demoInput({}, 'k1') });
    await handle({
      id: 2,
      kind: 'resilience',
      inputKey: 'k1',
      ref: 'composite',
      removed: ['OPE04'],
    });
    expect(out.at(-1)?.kind).toBe('resilience');
    await handle({
      id: 3,
      kind: 'bootstrap',
      inputKey: 'k1',
      opts: { ref: 'composite', metric: 'inStrength', replicates: 3, dropFraction: 0.1, seed: 1 },
    });
    expect(out.at(-1)?.kind).toBe('bootstrap');
    await handle({
      id: 5,
      kind: 'path',
      inputKey: 'k1',
      ref: 'composite',
      from: 'FIN01',
      to: 'PEO01',
    });
    const path = out.at(-1);
    expect(path?.kind === 'path' && path.result?.members[0]).toBe('FIN01');
    await handle({ id: 4, kind: 'resilience', inputKey: 'old', ref: 'composite', removed: [] });
    expect(out.at(-1)).toMatchObject({ id: 4, kind: 'error', code: 'staleInput' });
  });
});

describe('engine client', () => {
  /** A WorkerLike that runs the handler in-process, as the real worker does. */
  function fakeWorker(): WorkerLike & { sent: EngineRequest[] } {
    const sent: EngineRequest[] = [];
    const worker: WorkerLike & { sent: EngineRequest[] } = {
      sent,
      onmessage: null,
      postMessage(message) {
        sent.push(message);
        void handle(message);
      },
      terminate() {},
    };
    const handle = createEngineHandler((m) => {
      setTimeout(() => worker.onmessage?.({ data: m } as MessageEvent<EngineResponse>), 0);
    });
    return worker;
  }

  it('resolves an analysis and reports progress', async () => {
    const client = new EngineClient(fakeWorker());
    const progress: string[] = [];
    const result = await client.analyse(demoInput(), (_f, stage) => progress.push(stage)).promise;
    expect(result.refs.composite).toBeDefined();
    expect(progress).toContain('composite');
  });

  it('a new analysis cancels the previous one (latest wins)', async () => {
    const worker = fakeWorker();
    const client = new EngineClient(worker);
    const first = client.analyse(demoInput({}, 'a'));
    const second = client.analyse(demoInput({}, 'b'));
    await expect(first.promise).rejects.toBeInstanceOf(EngineCancelledError);
    expect((await second.promise).inputKey).toBe('b');
    expect(worker.sent.map((m) => m.kind)).toEqual(['analyse', 'cancel', 'analyse']);
  });

  it('requests a shortest path against the last analysis', async () => {
    const client = new EngineClient(fakeWorker());
    await client.analyse(demoInput({}, 'k')).promise;
    const path = await client.path('k', 'composite', 'FIN01', 'PEO01').promise;
    expect(path?.members.at(-1)).toBe('PEO01');
  });

  it('surfaces engine errors', async () => {
    const client = new EngineClient(fakeWorker());
    await expect(client.resilience('none', 'composite', []).promise).rejects.toBeInstanceOf(
      EngineError,
    );
  });
});
