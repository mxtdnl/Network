// Loads the NetworkX fixtures (tests/fixtures/*.json, written by
// scripts/generate_fixtures.py) and turns each case into engine inputs.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProject } from '../../src/data/projectFile';
import { buildAnalysisInput } from '../../src/engine/input';
import type {
  AnalysisInput,
  AttributeColumn,
  SymmetriseRule,
  ViewKind,
} from '../../src/engine/types';

const root = join(import.meta.dirname, '..', '..');

export type Num = number | null;

export interface FixtureRef {
  kind: 'unsigned' | 'positive' | 'negative' | 'composite';
  ties: number;
  weights: Num[];
  node: Record<string, Num[] | string | null>;
  network: {
    density: Num;
    reciprocity: { overall: Num; dyad: Num; mutual_dyads: number; asymmetric_dyads: number };
    average_clustering: Num;
    components: { weak?: number[]; strong?: number[]; connected?: number[] };
    centralisation: Record<string, Num>;
    mixing: Record<
      string,
      {
        groups: string[];
        excluded: number;
        internal: number;
        external: number;
        ei: Num;
        per_group: { group: string; size: number; internal: number; external: number; ei: Num }[];
        density: Num[][];
      }
    >;
    communities?: {
      partition: number[][];
      modularity: number;
      resolution: number;
      seed: number;
    } | null;
  };
  shortest_paths?: {
    from: number;
    to: number;
    distance: Num;
    count?: number;
    paths: number[][];
  }[];
  resilience?: {
    removed: number[];
    members: number;
    components: { weak?: number; strong?: number; connected?: number; largest: number };
    reachable_pairs: number;
    reachability: Num;
    average_distance: Num;
    average_hops: Num;
  }[];
}

export interface FixtureView {
  refs: Record<string, FixtureRef>;
  signed: Record<
    string,
    {
      in_positive: number[];
      in_negative: number[];
      in_positive_count: number[];
      in_negative_count: number[];
      triads?: {
        ppp: number;
        ppn: number;
        pnn: number;
        nnn: number;
        balanced: number;
        unbalanced: number;
        balance_ratio: Num;
      };
    }
  >;
  multiplex: {
    refs: string[];
    jaccard: Num[][];
    overlap_distribution: number[];
    formal_informal?: Record<string, number>;
  } | null;
}

export interface Fixture {
  meta: {
    networkx: string;
    scipy: string;
    numpy: string;
    python: string;
    seed: number;
    tolerances: {
      default: number;
      eigenvector: number;
      modularity_fixed_partition: number;
      louvain_modularity_floor: number;
    };
  };
  case: string;
  removals: number[][];
  views: Record<'directed' | SymmetriseRule, FixtureView>;
  input?: {
    ids: string[];
    layers: {
      key: string;
      min: number;
      max: number;
      signed: boolean;
      role?: 'formal' | 'informal';
    }[];
    ratings: Record<string, Num[]>;
    attributes: Record<string, AttributeColumn>;
  };
  demo_sha256?: string;
  composite_matrices?: Record<'positive' | 'filterNegative' | 'multiplier', Num[]> | null;
}

export const CASES = ['karate-unweighted', 'karate-weighted', 'karate-directed', 'demo'] as const;
export const VIEWS = ['directed', 'mean', 'min', 'max'] as const;
export type FixtureViewName = (typeof VIEWS)[number];

export function loadFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(join(root, 'tests', 'fixtures', `${name}.json`), 'utf8'),
  ) as Fixture;
}

export const demoText = readFileSync(join(root, 'src', 'demo', 'demo.ona.json'), 'utf8');

export function demoSha256(): string {
  return createHash('sha256')
    .update(readFileSync(join(root, 'src', 'demo', 'demo.ona.json')))
    .digest('hex');
}

export function viewSettings(view: FixtureViewName): {
  view: ViewKind;
  symmetrise: SymmetriseRule;
} {
  return view === 'directed'
    ? { view: 'directed', symmetrise: 'mean' }
    : { view: 'symmetrised', symmetrise: view };
}

/** Engine input for a fixture case in one view. */
export function inputFor(f: Fixture, view: FixtureViewName): AnalysisInput {
  const vs = viewSettings(view);
  if (f.case === 'demo') {
    const project = parseProject(demoText);
    return buildAnalysisInput(project, { ...vs, weights: {}, signedTreatment: {} }, `demo:${view}`);
  }
  const input = f.input;
  if (!input) throw new Error(`fixture ${f.case} has no input`);
  return {
    inputKey: `${f.case}:${view}`,
    memberIds: input.ids,
    attributes: input.attributes,
    layers: input.layers.map((l) => ({
      key: l.key,
      label: l.key,
      min: l.min,
      max: l.max,
      signed: l.signed,
      ...(l.role ? { role: l.role } : {}),
      defaultWeight: 1,
    })),
    ratings: input.layers.map((l) =>
      Float64Array.from(input.ratings[l.key] ?? [], (x) => x ?? NaN),
    ),
    settings: { ...vs, weights: {}, signedTreatment: {}, seed: f.meta.seed },
  };
}

// --------------------------------------------------------------- comparison

export interface MetricReport {
  comparisons: number;
  maxDiff: number;
  tolerance: number;
}

/** Largest absolute difference per metric, for the summary printed after the suite. */
export const report = new Map<string, MetricReport>();

export function record(metric: string, diff: number, tolerance: number, count = 1): void {
  const r = report.get(metric) ?? { comparisons: 0, maxDiff: 0, tolerance };
  r.comparisons += count;
  r.maxDiff = Math.max(r.maxDiff, diff);
  r.tolerance = tolerance;
  report.set(metric, r);
}

/**
 * Compares engine values with fixture values: null must be NaN and a number
 * must be within `tolerance`. Returns the problems found (empty when equal).
 */
export function compare(
  metric: string,
  actual: ArrayLike<number>,
  expected: readonly Num[],
  tolerance: number,
): string[] {
  const problems: string[] = [];
  if (actual.length !== expected.length) {
    return [`${metric}: length ${String(actual.length)} ≠ ${String(expected.length)}`];
  }
  let maxDiff = 0;
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i] as number;
    const e = expected[i];
    if (e === null || e === undefined) {
      if (!Number.isNaN(a))
        problems.push(`${metric}[${String(i)}]: expected undefined, got ${String(a)}`);
      continue;
    }
    if (Number.isNaN(a)) {
      problems.push(`${metric}[${String(i)}]: expected ${String(e)}, got NaN`);
      continue;
    }
    const d = Math.abs(a - e);
    maxDiff = Math.max(maxDiff, d);
    if (!(d <= tolerance))
      problems.push(
        `${metric}[${String(i)}]: expected ${String(e)}, got ${String(a)} (Δ ${d.toExponential(2)})`,
      );
  }
  record(metric, maxDiff, tolerance, expected.length);
  return problems;
}

export function compareScalar(
  metric: string,
  actual: number,
  expected: Num,
  tolerance: number,
): string[] {
  return compare(metric, [actual], [expected], tolerance);
}

export function formatReport(): string {
  const rows = [...report.entries()].sort(([a], [b]) => a.localeCompare(b));
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows
    .map(
      ([k, r]) =>
        `${k.padEnd(width)}  ${String(r.comparisons).padStart(7)} values  max |Δ| ${r.maxDiff.toExponential(2)}  tol ${r.tolerance.toExponential(0)}`,
    )
    .join('\n');
}
