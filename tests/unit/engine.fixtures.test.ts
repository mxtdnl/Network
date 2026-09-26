// The engine against NetworkX reference values (spec §6 "Correctness").
// Fixtures: tests/fixtures/*.json from scripts/generate_fixtures.py (NetworkX
// version in each file's meta). Tolerances come from the fixture files:
// 1e-9 absolute for every metric except eigenvector centrality (1e-6, an
// iterative method), exact equality for counts. Conventions that differ from
// NetworkX are applied in the fixture script and documented in
// docs/method-notes.md; tolerances are never widened to force a pass.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysePrepared, prepare, runResilience, type Prepared } from '../../src/engine/analyse';
import { compositeFormula, compositeMatrix } from '../../src/engine/composite';
import { denseGraph } from '../../src/engine/graphs';
import { partitionModularity } from '../../src/engine/metrics/network';
import type { AnalysisResult, NodeMetricKey, SignedTreatment } from '../../src/engine/types';
import {
  CASES,
  compare,
  compareScalar,
  demoSha256,
  formatReport,
  inputFor,
  loadFixture,
  record,
  VIEWS,
  type Fixture,
  type FixtureViewName,
} from './engineFixtures';

const NODE_KEYS: Record<string, { directed: NodeMetricKey; symmetrised: NodeMetricKey }> = {
  in_strength: { directed: 'inStrength', symmetrised: 'inStrength' },
  out_strength: { directed: 'outStrength', symmetrised: 'outStrength' },
  strength: { directed: 'strength', symmetrised: 'strength' },
  in_degree: { directed: 'inDegree', symmetrised: 'inDegree' },
  out_degree: { directed: 'outDegree', symmetrised: 'outDegree' },
  degree: { directed: 'degree', symmetrised: 'degree' },
  betweenness: { directed: 'betweenness', symmetrised: 'betweenness' },
  betweenness_binary: { directed: 'betweennessBinary', symmetrised: 'betweennessBinary' },
  harmonic_in: { directed: 'harmonicIn', symmetrised: 'harmonic' },
  harmonic_out: { directed: 'harmonicOut', symmetrised: 'harmonicOut' },
  eigenvector: { directed: 'eigenvector', symmetrised: 'eigenvector' },
  constraint: { directed: 'constraint', symmetrised: 'constraint' },
  effective_size: { directed: 'effectiveSize', symmetrised: 'effectiveSize' },
  clustering: { directed: 'clustering', symmetrised: 'clustering' },
};
const CENTRALISATION_KEYS: Record<string, 'inDegree' | 'outDegree' | 'degree' | 'betweenness'> = {
  in_degree: 'inDegree',
  out_degree: 'outDegree',
  degree: 'degree',
  betweenness: 'betweenness',
};

afterAll(() => {
  console.log(`\nFixture match (max |engine − NetworkX| per metric)\n${formatReport()}\n`);
});

for (const name of CASES) {
  describe(`fixture ${name}`, () => {
    const f: Fixture = loadFixture(name);
    const tol = f.meta.tolerances;
    const runs = new Map<FixtureViewName, { prepared: Prepared; result: AnalysisResult }>();

    beforeAll(async () => {
      for (const view of VIEWS) {
        const prepared = prepare(inputFor(f, view));
        runs.set(view, { prepared, result: await analysePrepared(prepared) });
      }
    });

    const run = (view: FixtureViewName) => {
      const r = runs.get(view);
      if (!r) throw new Error('analysis missing');
      return r;
    };

    if (name === 'demo') {
      it('was generated from the committed demo project', () => {
        expect(f.demo_sha256).toBe(demoSha256());
      });
    }

    for (const view of VIEWS) {
      describe(`${view} view`, () => {
        const fv = f.views[view];
        const directed = view === 'directed';

        it('has the same layers', () => {
          expect(run(view).result.refOrder).toEqual(Object.keys(fv.refs));
        });

        for (const [ref, fr] of Object.entries(fv.refs)) {
          describe(ref, () => {
            it('aggregates ties to the same weights', () => {
              const p = run(view).prepared.refs.find((x) => x.ref === ref);
              expect(
                compare('weights (aggregation, composite)', p?.view ?? [], fr.weights, tol.default),
              ).toEqual([]);
            });

            it('matches every node metric', () => {
              const node = run(view).result.refs[ref]?.node;
              const problems: string[] = [];
              const expectedKeys: NodeMetricKey[] = [];
              for (const [fk, values] of Object.entries(fr.node)) {
                if (!Array.isArray(values)) continue;
                const key = NODE_KEYS[fk]?.[directed ? 'directed' : 'symmetrised'];
                if (!key) throw new Error(`unmapped fixture metric ${fk}`);
                expectedKeys.push(key);
                const t = fk === 'eigenvector' ? tol.eigenvector : tol.default;
                problems.push(...compare(key, node?.columns[key] ?? [], values, t));
              }
              expect(problems).toEqual([]);
              // Nothing computed beyond what NetworkX checks, except the
              // in/out columns the symmetrised view does not report.
              expect(Object.keys(node?.columns ?? {}).sort()).toEqual(expectedKeys.sort());
              if (fr.kind === 'negative') expect(node?.omitted?.reason).toBe('negativeSubLayer');
            });

            it('matches the network metrics', () => {
              const net = run(view).result.refs[ref]?.network;
              if (!net) throw new Error('missing');
              const fn = fr.network;
              const problems = [
                ...compareScalar('density', net.density, fn.density, tol.default),
                ...compareScalar(
                  'reciprocity (overall)',
                  net.reciprocity.overall,
                  fn.reciprocity.overall,
                  tol.default,
                ),
                ...compareScalar(
                  'reciprocity (dyad)',
                  net.reciprocity.dyad,
                  fn.reciprocity.dyad,
                  tol.default,
                ),
                ...compareScalar(
                  'average clustering',
                  net.averageClustering,
                  fn.average_clustering,
                  tol.default,
                ),
              ];
              for (const [fk, v] of Object.entries(fn.centralisation)) {
                const key = CENTRALISATION_KEYS[fk];
                if (!key) throw new Error(`unmapped centralisation ${fk}`);
                problems.push(
                  ...compareScalar(
                    `centralisation (${key})`,
                    net.centralisation[key] ?? NaN,
                    v,
                    tol.default,
                  ),
                );
              }
              for (const [attr, m] of Object.entries(fn.mixing)) {
                const mine = net.mixing[attr];
                if (!mine) throw new Error(`missing mixing for ${attr}`);
                expect(mine.groups).toEqual(m.groups);
                expect([mine.excluded, mine.internal, mine.external]).toEqual([
                  m.excluded,
                  m.internal,
                  m.external,
                ]);
                problems.push(...compareScalar('E-I index', mine.ei, m.ei, tol.default));
                problems.push(
                  ...compare(
                    'E-I index (per group)',
                    mine.perGroup.map((g) => g.ei),
                    m.per_group.map((g) => g.ei),
                    tol.default,
                  ),
                );
                expect(mine.perGroup.map((g) => [g.size, g.internal, g.external])).toEqual(
                  m.per_group.map((g) => [g.size, g.internal, g.external]),
                );
                problems.push(
                  ...compare('cross-group density', mine.density, m.density.flat(), tol.default),
                );
              }
              expect(problems).toEqual([]);
              expect(net.ties).toBe(fr.ties);
              expect([net.reciprocity.mutualDyads, net.reciprocity.asymmetricDyads]).toEqual([
                fn.reciprocity.mutual_dyads,
                fn.reciprocity.asymmetric_dyads,
              ]);
              expect(net.components).toEqual(fn.components);
              record('components (exact)', 0, 0);
              record('tie counts, dyad counts, E-I counts (exact)', 0, 0);
            });

            if (!directed) {
              it('matches NetworkX modularity for its partition, and Louvain is no worse', () => {
                const expected = fr.network.communities;
                const mine = run(view).result.refs[ref]?.communities ?? null;
                if (!expected) {
                  expect(mine).toBeNull();
                  return;
                }
                if (!mine) throw new Error('no communities');
                const p = run(view).prepared.refs.find((x) => x.ref === ref);
                if (!p) throw new Error('missing');
                const membership = new Int32Array(run(view).prepared.n);
                expected.partition.forEach((members, c) => {
                  for (const m of members) membership[m] = c;
                });
                const g = denseGraph(p.symmetric, membership.length, false);
                expect(
                  compareScalar(
                    'modularity (fixed NetworkX partition)',
                    partitionModularity(g, membership),
                    expected.modularity,
                    tol.modularity_fixed_partition,
                  ),
                ).toEqual([]);
                const shortfall = Math.max(0, expected.modularity - mine.modularity);
                record(
                  'Louvain modularity shortfall vs NetworkX',
                  shortfall,
                  tol.louvain_modularity_floor,
                );
                expect(mine.modularity).toBeGreaterThanOrEqual(
                  expected.modularity - tol.louvain_modularity_floor,
                );
                expect(mine.resolution).toBe(expected.resolution);
              });
            } else {
              it('detects communities on the symmetrised graph (plan Q9)', () => {
                const mine = run(view).result.refs[ref]?.communities;
                const sym = run('mean').result.refs[ref]?.communities;
                expect(mine?.membership).toEqual(sym?.membership);
                expect(mine?.modularity).toBe(sym?.modularity);
              });
            }

            if (fr.resilience) {
              it('matches resilience after removals', () => {
                const { prepared } = run(view);
                const problems: string[] = [];
                for (const fx of fr.resilience ?? []) {
                  const removed = fx.removed.map((i) => prepared.input.memberIds[i] as string);
                  const res = runResilience(prepared, ref, removed);
                  expect(res.after.members).toBe(fx.members);
                  expect(res.after.components).toEqual(fx.components);
                  expect(res.after.reachablePairs).toBe(fx.reachable_pairs);
                  problems.push(
                    ...compareScalar(
                      'resilience reachability',
                      res.after.reachability,
                      fx.reachability,
                      tol.default,
                    ),
                    ...compareScalar(
                      'resilience average distance',
                      res.after.averageDistance,
                      fx.average_distance,
                      tol.default,
                    ),
                    ...compareScalar(
                      'resilience average hops',
                      res.after.averageHops,
                      fx.average_hops,
                      tol.default,
                    ),
                  );
                }
                expect(problems).toEqual([]);
              });
            }
          });
        }

        if (Object.keys(fv.signed).length > 0) {
          it('matches signed in-valence and structural balance', () => {
            const problems: string[] = [];
            for (const [key, fs] of Object.entries(fv.signed)) {
              const mine = run(view).result.signed[key];
              if (!mine) throw new Error(`missing signed ${key}`);
              problems.push(
                ...compare('positive in-valence', mine.inPositive, fs.in_positive, tol.default),
                ...compare('negative in-valence', mine.inNegative, fs.in_negative, tol.default),
              );
              expect(Array.from(mine.inPositiveCount)).toEqual(fs.in_positive_count);
              expect(Array.from(mine.inNegativeCount)).toEqual(fs.in_negative_count);
              if (fs.triads) {
                const t = mine.triads;
                expect([t.ppp, t.ppn, t.pnn, t.nnn, t.balanced, t.unbalanced]).toEqual([
                  fs.triads.ppp,
                  fs.triads.ppn,
                  fs.triads.pnn,
                  fs.triads.nnn,
                  fs.triads.balanced,
                  fs.triads.unbalanced,
                ]);
                problems.push(
                  ...compareScalar(
                    'balance ratio',
                    t.balanceRatio,
                    fs.triads.balance_ratio,
                    tol.default,
                  ),
                );
                record('signed triad counts (exact)', 0, 0);
              }
            }
            expect(problems).toEqual([]);
          });
        }

        if (fv.multiplex) {
          it('matches multiplexity and the formal–informal classification', () => {
            const mx = run(view).result.multiplex;
            const fm = fv.multiplex;
            if (!mx || !fm) throw new Error('missing multiplex');
            expect(mx.refs).toEqual(fm.refs);
            expect(
              compare('multiplex Jaccard overlap', mx.jaccard, fm.jaccard.flat(), tol.default),
            ).toEqual([]);
            expect(mx.overlapDistribution).toEqual(fm.overlap_distribution);
            if (fm.formal_informal) {
              const c = mx.formalInformal?.counts;
              expect(
                c && [c.formalOnly, c.informalOnly, c.both, c.neither, c.notClassified],
              ).toEqual([
                fm.formal_informal.formal_only,
                fm.formal_informal.informal_only,
                fm.formal_informal.both,
                fm.formal_informal.neither,
                fm.formal_informal.not_classified,
              ]);
              record('formal–informal counts (exact)', 0, 0);
            }
            record('multiplex overlap distribution (exact)', 0, 0);
          });
        }
      });
    }

    if (f.composite_matrices) {
      it('matches the composite under each signed-layer treatment', () => {
        const input = inputFor(f, 'directed');
        const n = input.memberIds.length;
        const problems: string[] = [];
        for (const [treatment, expected] of Object.entries(f.composite_matrices ?? {})) {
          const signedTreatment: Record<string, SignedTreatment> = {};
          for (const l of input.layers)
            if (l.signed) signedTreatment[l.key] = treatment as SignedTreatment;
          const formula = compositeFormula(input.layers, { ...input.settings, signedTreatment });
          if (!formula) throw new Error('no formula');
          problems.push(
            ...compare(
              `composite (${treatment})`,
              compositeMatrix(formula, input.layers, input.ratings, n),
              expected,
              tol.default,
            ),
          );
        }
        expect(problems).toEqual([]);
      });
    }
  });
}
