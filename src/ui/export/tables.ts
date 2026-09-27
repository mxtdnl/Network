// CSV exports (spec §11): member metrics, network metrics and the formal–
// informal classification of pairs. Pure functions of the export context, so
// anonymisation (names from the names layer) and the signed-layer exclusion
// (the context's project and analysis) apply to every row. RFC 4180, UTF-8
// with a byte-order mark and CRLF line ends, like the Phase 5 table export
// (CLAUDE.md D66); values are unrounded and a value that is not defined is an
// empty cell.

import type { SizeMetric } from '../state/store';
import { FI_CLASS } from '../engineClient';
import { exportCopy } from '../copy/export';
import { DIRECTED_METRICS, SYMMETRISED_METRICS, flagCopy, metricCopy } from '../copy/metrics';
import { mapCopy } from '../copy/map';
import { groupAttributes } from '../map/model';
import { tableCopy as exportTableCopy } from '../copy/table';
import { toCsv } from '../views/csv';
import type { ExportContext } from './context';

const C = exportCopy.csv;

export interface ExportFile {
  fileName: string;
  text: string;
}

const cell = (v: number) => (Number.isFinite(v) ? String(v) : '');

/** File-name part for the view: `directed`, or `mutual-mean` and so on. */
export function viewSlug(ctx: ExportContext): string {
  const base = ctx.result.view === 'directed' ? 'directed' : `mutual-${ctx.result.symmetrise}`;
  return `${base}${exportCopy.suffix(ctx.anonymised, ctx.reanalysed)}`;
}

/** Plain label of a layer reference in the export's project. */
export function refName(ctx: ExportContext, ref: string): string {
  if (ref === 'composite') return mapCopy.controls.composite;
  const signed = ref.endsWith('+') ? '+' : ref.endsWith('-') ? '-' : '';
  const key = signed ? ref.slice(0, -1) : ref;
  const label = ctx.project.layers.find((l) => l.key === key)?.label ?? key;
  if (signed === '+') return C.positive(label);
  if (signed === '-') return C.negative(label);
  return label;
}

/** Layer references in export order: the composite, then layers in project order. */
export function exportRefs(ctx: ExportContext): string[] {
  const order = new Map(ctx.project.layers.map((l, i) => [l.key, i]));
  const base = (ref: string) => (ref.endsWith('+') || ref.endsWith('-') ? ref.slice(0, -1) : ref);
  return [...ctx.result.refOrder]
    .filter((ref) => ctx.result.refs[ref] !== undefined)
    .sort((a, b) => {
      if (a === 'composite') return -1;
      if (b === 'composite') return 1;
      return (
        (order.get(base(a)) ?? 0) - (order.get(base(b)) ?? 0) ||
        Number(a.endsWith('-')) - Number(b.endsWith('-'))
      );
    });
}

function viewText(ctx: ExportContext): string {
  return ctx.result.view === 'directed'
    ? C.directed
    : C.symmetrised(C.rules[ctx.result.symmetrise]);
}

// ------------------------------------------------------------ member metrics

/** One row per member and layer: every node metric of the view, plus received signed ratings. */
export function memberMetricsCsv(ctx: ExportContext): ExportFile {
  const { project, result, names } = ctx;
  const metrics: NodeMetricKey[] = [
    ...(result.view === 'directed' ? DIRECTED_METRICS : SYMMETRISED_METRICS),
  ];
  metrics.splice(metrics.indexOf('betweenness') + 1, 0, 'betweennessBinary');
  const label = (m: NodeMetricKey) =>
    m === 'betweennessBinary'
      ? C.betweennessBinary
      : `${metricCopy[m].label} (${metricCopy[m].technical.toLowerCase()})`;
  const attributes = groupAttributes(project);
  const anySigned = Object.keys(result.signed).length > 0;
  const header = [
    C.member,
    // Member ids can be names or email addresses, so they are left out when names are hidden.
    ...(ctx.anonymised ? [] : [C.memberId]),
    ...attributes.map((a) => a.label),
    C.layer,
    C.community,
    ...metrics.map(label),
    C.notDefinedReason,
    ...(anySigned ? [C.receivedRatings, C.raters] : []),
  ];
  const rows: string[][] = [header];
  for (const ref of exportRefs(ctx)) {
    const r = result.refs[ref];
    if (!r) continue;
    const signed = r.layer ? result.signed[r.layer] : undefined;
    project.members.forEach((m, i) => {
      const reasons = new Set<string>();
      for (const k of metrics) {
        const flag = r.node.flags[k]?.[i];
        if (
          flag &&
          flag !== 'fewerThanTwoContacts' &&
          !Number.isFinite(r.node.columns[k]?.[i] ?? NaN)
        )
          reasons.add(flagCopy[flag].replace(/^Not defined: /, ''));
      }
      if (r.node.omitted) reasons.add(flagCopy.negativeSubLayer);
      const received =
        signed && r.kind === 'positive'
          ? [cell(signed.inPositive[i] ?? NaN), cell(signed.inPositiveCount[i] ?? NaN)]
          : signed && r.kind === 'negative'
            ? [cell(-(signed.inNegative[i] ?? NaN)), cell(signed.inNegativeCount[i] ?? NaN)]
            : ['', ''];
      rows.push([
        names.of(m.id),
        ...(ctx.anonymised ? [] : [m.id]),
        ...attributes.map((a) => m.attributes[a.key] ?? ''),
        refName(ctx, ref),
        r.communities ? String((r.communities.membership[i] ?? 0) + 1) : '',
        ...metrics.map((k) => cell(r.node.columns[k]?.[i] ?? NaN)),
        [...reasons].join(' '),
        ...(anySigned ? received : []),
      ]);
    });
  }
  return { fileName: exportCopy.files.members(viewSlug(ctx)), text: toCsv(rows) };
}

// ----------------------------------------------------------- network metrics

/** Long format: one row per layer and measure, with the group columns for mixing. */
export function networkMetricsCsv(ctx: ExportContext): ExportFile {
  const { project, result } = ctx;
  const M = C.measures;
  const rows: string[][] = [[C.layer, C.measure, C.attribute, C.group, C.otherGroup, C.value]];
  const add = (layer: string, measure: string, value: string, attr = '', g = '', other = '') => {
    rows.push([layer, measure, attr, g, other, value]);
  };
  const attrLabel = (key: string) =>
    project.attribute_definitions.find((a) => a.key === key)?.label ?? key;

  add('', M.view, viewText(ctx));
  const coverage = result.coverage;
  if (coverage) {
    add('', M.coverage, cell(coverage.rate));
    add('', M.coverageThreshold, cell(coverage.threshold));
  }
  if (result.composite) add(mapCopy.controls.composite, M.formula, result.composite.notation);

  const refs = exportRefs(ctx);
  for (const ref of refs) {
    const r = result.refs[ref];
    if (!r) continue;
    const name = refName(ctx, ref);
    const n = r.network;
    add(name, M.members, cell(n.members));
    add(name, M.ties, cell(n.ties));
    add(name, M.density, cell(n.density));
    add(name, M.tieReciprocity, cell(n.reciprocity.overall));
    add(name, M.dyadReciprocity, cell(n.reciprocity.dyad));
    add(name, M.mutualPairs, cell(n.reciprocity.mutualDyads));
    add(name, M.oneWayPairs, cell(n.reciprocity.asymmetricDyads));
    add(name, M.averageClustering, cell(n.averageClustering));
    const c = n.components;
    if (c.weak) {
      add(name, M.weakComponents, cell(c.weak.length));
      add(name, M.largestWeak, cell(c.weak[0] ?? 0));
    }
    if (c.strong) {
      add(name, M.strongComponents, cell(c.strong.length));
      add(name, M.largestStrong, cell(c.strong[0] ?? 0));
    }
    if (c.connected) {
      add(name, M.components, cell(c.connected.length));
      add(name, M.largestComponent, cell(c.connected[0] ?? 0));
    }
    const z = n.centralisation;
    if (z.inDegree !== undefined) add(name, M.centralisationIn, cell(z.inDegree));
    if (z.outDegree !== undefined) add(name, M.centralisationOut, cell(z.outDegree));
    if (z.degree !== undefined) add(name, M.centralisationDegree, cell(z.degree));
    if (z.betweenness !== undefined) add(name, M.centralisationBetweenness, cell(z.betweenness));
    if (r.communities) {
      add(name, M.communities, cell(r.communities.count));
      add(name, M.modularity, cell(r.communities.modularity));
    }
    for (const [key, mix] of Object.entries(n.mixing)) {
      const a = attrLabel(key);
      add(name, M.ei, cell(mix.ei), a);
      add(name, M.eiExcluded, cell(mix.excluded), a);
      for (const g of mix.perGroup) {
        add(name, M.groupSize, cell(g.size), a, g.group);
        add(name, M.internalTies, cell(g.internal), a, g.group);
        add(name, M.externalTies, cell(g.external), a, g.group);
        add(name, M.ei, cell(g.ei), a, g.group);
      }
      const k = mix.groups.length;
      for (let x = 0; x < k; x++) {
        for (let y = 0; y < k; y++) {
          add(
            name,
            M.crossDensity,
            cell(mix.density[x * k + y] ?? NaN),
            a,
            mix.groups[x] ?? '',
            mix.groups[y] ?? '',
          );
        }
      }
    }
  }

  for (const [key, s] of Object.entries(result.signed)) {
    const name = refName(ctx, key);
    const t = s.triads;
    add(name, M.triad('+ + +'), cell(t.ppp));
    add(name, M.triad('+ + −'), cell(t.ppn));
    add(name, M.triad('+ − −'), cell(t.pnn));
    add(name, M.triad('− − −'), cell(t.nnn));
    add(name, M.balanced, cell(t.balanced));
    add(name, M.unbalanced, cell(t.unbalanced));
    add(name, M.balanceRatio, cell(t.balanceRatio));
  }

  const mx = result.multiplex;
  if (mx) {
    const k = mx.refs.length;
    for (let x = 0; x < k; x++) {
      for (let y = x + 1; y < k; y++) {
        add(
          refName(ctx, mx.refs[x] ?? ''),
          M.overlap(refName(ctx, mx.refs[y] ?? '')),
          cell(mx.jaccard[x * k + y] ?? NaN),
        );
      }
    }
    const fi = mx.formalInformal;
    if (fi) {
      const L = C.formalInformalLayer;
      add(L, M.formalOnly, cell(fi.counts.formalOnly));
      add(L, M.informalOnly, cell(fi.counts.informalOnly));
      add(L, M.both, cell(fi.counts.both));
      add(L, M.neither, cell(fi.counts.neither));
      add(L, M.notClassified, cell(fi.counts.notClassified));
    }
  }
  return { fileName: exportCopy.files.network(viewSlug(ctx)), text: toCsv(rows) };
}

// ------------------------------------------------ formal–informal classification

const CLASS_TEXT: Record<number, string> = {
  [FI_CLASS.formalOnly]: C.classes.formalOnly,
  [FI_CLASS.informalOnly]: C.classes.informalOnly,
  [FI_CLASS.both]: C.classes.both,
  [FI_CLASS.neither]: C.classes.neither,
  [FI_CLASS.notClassified]: C.classes.notClassified,
};

/** True when the analysis has the formal–informal classification. */
export function hasFormalInformal(ctx: ExportContext): boolean {
  return ctx.result.multiplex?.formalInformal !== null && ctx.result.multiplex !== null;
}

/** Every classified pair: ordered (rater first) in the directed view, unordered when mutual. */
export function formalInformalCsv(ctx: ExportContext): ExportFile | null {
  const fi = ctx.result.multiplex?.formalInformal;
  if (!fi) return null;
  const { project, names } = ctx;
  const n = project.members.length;
  const directed = ctx.result.view === 'directed';
  const team = groupAttributes(project).find((a) => a.key === 'team');
  const rows: string[][] = [
    [
      directed ? C.from : C.memberA,
      directed ? C.to : C.memberB,
      ...(team ? [C.teamOf(team.label), C.teamOfOther(team.label)] : []),
      C.classification,
    ],
  ];
  for (let i = 0; i < n; i++) {
    for (let j = directed ? 0 : i + 1; j < n; j++) {
      if (i === j) continue;
      const text = CLASS_TEXT[fi.classes[i * n + j] ?? FI_CLASS.none];
      if (!text) continue;
      const a = project.members[i];
      const b = project.members[j];
      if (!a || !b) continue;
      rows.push([
        names.of(a.id),
        names.of(b.id),
        ...(team ? [a.attributes[team.key] ?? '', b.attributes[team.key] ?? ''] : []),
        text,
      ]);
    }
  }
  return { fileName: exportCopy.files.formalInformal(viewSlug(ctx)), text: toCsv(rows) };
}

// ------------------------------------------------------ the metrics table view

export interface TableSpec {
  /** Members in the order the table shows them. */
  order: readonly string[];
  /** Metric columns, in order. */
  metrics: readonly SizeMetricKey[];
  /** The fill attribute column, or null. */
  fillKey: string | null;
  /** Rank ranges from the bootstrap on screen; dropped when the export is calculated again. */
  rank: { metric: SizeMetricKey; low: Float64Array; high: Float64Array } | null;
}

type SizeMetricKey = SizeMetric;
type NodeMetricKey = SizeMetric | 'betweennessBinary';

/**
 * The Phase 5 table export (CLAUDE.md D66) under both export settings: the
 * rows and columns shown, in their order, with values from the export's
 * analysis. When the signed-layer exclusion recalculates the analysis, the
 * rank-range column is left out, because the resampling ran on the analysis
 * with those layers.
 */
export function metricsTableCsv(ctx: ExportContext, spec: TableSpec): ExportFile {
  const T = exportTableCopy;
  const { project, result, settings, names } = ctx;
  const ref = result.refs[settings.layer];
  const index = new Map(project.members.map((m, i) => [m.id, i]));
  const fillAttr = project.attribute_definitions.find((a) => a.key === spec.fillKey);
  const rank = ctx.reanalysed ? null : spec.rank;
  const metrics = spec.metrics.filter((m) => ref?.node.columns[m] !== undefined);
  const header = [
    T.member,
    ...(fillAttr ? [fillAttr.label] : []),
    ...(ref?.communities ? [T.community] : []),
    ...metrics.flatMap((m) => [
      metricCopy[m].label,
      ...(rank && rank.metric === m ? [T.rankRangeLong(metricCopy[m].label)] : []),
    ]),
  ];
  const rows: string[][] = [header];
  for (const id of spec.order) {
    const i = index.get(id);
    const m = i === undefined ? undefined : project.members[i];
    if (i === undefined || !m) continue;
    rows.push([
      names.of(id),
      ...(fillAttr ? [m.attributes[fillAttr.key] ?? ''] : []),
      ...(ref?.communities ? [String((ref.communities.membership[i] ?? 0) + 1)] : []),
      ...metrics.flatMap((k) => [
        cell(ref?.node.columns[k]?.[i] ?? NaN),
        ...(rank && rank.metric === k
          ? [
              Number.isFinite(rank.low[i] ?? NaN)
                ? `${String(rank.low[i])}–${String(rank.high[i])}`
                : '',
            ]
          : []),
      ]),
    ]);
  }
  const fileName = `graticule-metrics-${settings.layer}-${result.view}${exportCopy.suffix(
    ctx.anonymised,
    ctx.reanalysed,
  )}.csv`;
  return { fileName, text: toCsv(rows) };
}
