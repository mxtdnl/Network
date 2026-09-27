// The PDF report's content (spec §11): a cover, the map, key network metrics,
// insights, method notes, data coverage with survey response rates, and an
// ethics statement. Built as plain blocks from the export context, so the
// wording, anonymisation and the signed-layer exclusion can be tested without
// a PDF; export/pdf.ts lays the blocks out on pages.

import { DEFAULT_WAVE, isCategorical } from '../../data/schema';
import { surveyStatus } from '../../survey/model';
import { percent } from '../copy/data';
import { exportCopy, reportCopy as R } from '../copy/export';
import {
  insightsCopy,
  questionText,
  ruleText,
  viewText,
  type InsightContext,
} from '../copy/insights';
import { formatValue } from '../copy/map';
import { coverageCopy } from '../copy/data';
import type { ExportContext } from './context';
import { insightCaveats, reportNotes } from './methodNotes';
import { exportRefs, refName } from './tables';

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string; lead?: string; tone?: 'ink' | 'graphite'; small?: boolean }
  | { kind: 'warning'; text: string }
  | {
      kind: 'table';
      columns: { label: string; numeric: boolean }[];
      rows: string[][];
    };

export interface ReportSection {
  title: string;
  blocks: Block[];
}

export interface ReportModel {
  /** Document title: the project title with names replaced when anonymised. */
  title: string;
  subtitle: string;
  date: string;
  cover: string[];
  contents: string[];
  mapIntro: string;
  sections: ReportSection[];
}

const M = exportCopy.csv.measures;
const value = (v: number | undefined) =>
  v === undefined || !Number.isFinite(v) ? R.metrics.notDefined : formatValue(v);

function metricsSection(ctx: ExportContext): Block[] {
  const { result } = ctx;
  const refs = exportRefs(ctx);
  const blocks: Block[] = [{ kind: 'paragraph', text: R.metrics.intro, tone: 'graphite' }];
  if (refs.length === 0) return [...blocks, { kind: 'paragraph', text: R.metrics.none }];
  const nets = refs.map((ref) => result.refs[ref]);
  const row = (label: string, pick: (i: number) => number | undefined): string[] => [
    label,
    ...nets.map((_, i) => value(pick(i))),
  ];
  const directed = result.view === 'directed';
  const rows: string[][] = [
    row(M.members, (i) => nets[i]?.network.members),
    row(M.ties, (i) => nets[i]?.network.ties),
    row(M.density, (i) => nets[i]?.network.density),
    row(M.tieReciprocity, (i) => nets[i]?.network.reciprocity.overall),
    row(M.averageClustering, (i) => nets[i]?.network.averageClustering),
    ...(directed
      ? [
          row(M.weakComponents, (i) => nets[i]?.network.components.weak?.length),
          row(M.largestWeak, (i) => nets[i]?.network.components.weak?.[0]),
          row(M.centralisationIn, (i) => nets[i]?.network.centralisation.inDegree),
          row(M.centralisationOut, (i) => nets[i]?.network.centralisation.outDegree),
        ]
      : [
          row(M.components, (i) => nets[i]?.network.components.connected?.length),
          row(M.largestComponent, (i) => nets[i]?.network.components.connected?.[0]),
          row(M.centralisationDegree, (i) => nets[i]?.network.centralisation.degree),
        ]),
    row(M.centralisationBetweenness, (i) => nets[i]?.network.centralisation.betweenness),
    row(M.communities, (i) => nets[i]?.communities?.count),
    row(M.modularity, (i) => nets[i]?.communities?.modularity),
  ];
  blocks.push({
    kind: 'table',
    columns: [
      { label: R.metrics.measure, numeric: false },
      ...refs.map((ref) => ({ label: refName(ctx, ref), numeric: true })),
    ],
    rows,
  });
  if (result.composite) {
    blocks.push({
      kind: 'paragraph',
      lead: R.metrics.formula,
      text: result.composite.notation,
      small: true,
    });
  }

  // Mixing between teams on the composite (or the first layer).
  const main = result.refs[refs[0] ?? ''];
  const mixKey = main
    ? 'team' in main.network.mixing
      ? 'team'
      : Object.keys(main.network.mixing)[0]
    : undefined;
  const mix = main && mixKey ? main.network.mixing[mixKey] : undefined;
  if (main && mix && mixKey) {
    const attr = ctx.project.attribute_definitions.find((a) => a.key === mixKey)?.label ?? mixKey;
    blocks.push({
      kind: 'heading',
      text: R.metrics.mixing(attr.toLowerCase(), refName(ctx, refs[0] ?? '')),
    });
    blocks.push({
      kind: 'table',
      columns: [
        { label: R.metrics.group, numeric: false },
        { label: R.metrics.size, numeric: true },
        { label: R.metrics.internal, numeric: true },
        { label: R.metrics.external, numeric: true },
        { label: R.metrics.ei, numeric: true },
      ],
      rows: [
        ...mix.perGroup.map((g) => [
          g.group,
          value(g.size),
          value(g.internal),
          value(g.external),
          signed(g.ei),
        ]),
        [
          R.metrics.allGroups,
          value(mix.perGroup.reduce((s, g) => s + g.size, 0)),
          value(mix.internal),
          value(mix.external),
          signed(mix.ei),
        ],
      ],
    });
    blocks.push({ kind: 'paragraph', text: R.metrics.mixingNote, tone: 'graphite', small: true });
  }

  for (const [key, s] of Object.entries(result.signed)) {
    blocks.push({ kind: 'heading', text: R.metrics.signed(refName(ctx, key)) });
    blocks.push({
      kind: 'table',
      columns: [
        { label: R.metrics.measure, numeric: false },
        { label: exportCopy.csv.value, numeric: true },
      ],
      rows: [
        [M.balanced, value(s.triads.balanced)],
        [M.unbalanced, value(s.triads.unbalanced)],
        [M.balanceRatio, value(s.triads.balanceRatio)],
      ],
    });
  }

  const fi = result.multiplex?.formalInformal;
  if (fi) {
    const c = fi.counts;
    blocks.push({ kind: 'heading', text: R.metrics.formalInformal });
    blocks.push({
      kind: 'table',
      columns: [
        { label: R.metrics.measure, numeric: false },
        { label: exportCopy.csv.value, numeric: true },
      ],
      rows: [
        [M.formalOnly, value(c.formalOnly)],
        [M.informalOnly, value(c.informalOnly)],
        [M.both, value(c.both)],
        [M.neither, value(c.neither)],
        [M.notClassified, value(c.notClassified)],
      ],
    });
  }
  return blocks;
}

/** −0.89 with a true minus sign; two decimals. */
function signed(v: number): string {
  if (!Number.isFinite(v)) return R.metrics.notDefined;
  const text = Math.abs(v).toFixed(2);
  return v < 0 ? `−${text}` : text;
}

function insightsSection(ctx: ExportContext, notes: string): Block[] {
  const { project, result, names } = ctx;
  const insightCtx: InsightContext = {
    layerLabel: (ref) => refName(ctx, ref),
    attributeLabel: (key) => project.attribute_definitions.find((a) => a.key === key)?.label ?? key,
  };
  const blocks: Block[] = [{ kind: 'paragraph', text: R.insights.intro, tone: 'graphite' }];
  if (result.coverage?.belowThreshold) {
    blocks.push({ kind: 'warning', text: insightsCopy.coverage(percent(result.coverage.rate)) });
  }
  const directed = result.view === 'directed';
  for (const outcome of result.insights) {
    // Negative clusters read only signed layers; with them left out the rule is not listed at all.
    if (outcome.rule === 'negativeCluster' && ctx.excludeSigned) continue;
    blocks.push({ kind: 'heading', text: insightsCopy.titles[outcome.rule] });
    blocks.push({
      kind: 'paragraph',
      lead: insightsCopy.ruleLabel,
      text: ruleText(outcome.rule, directed),
      tone: 'graphite',
      small: true,
    });
    if (outcome.status === 'unavailable' && outcome.reason)
      blocks.push({ kind: 'paragraph', text: insightsCopy.unavailable[outcome.reason] });
    if (outcome.status === 'none') blocks.push({ kind: 'paragraph', text: insightsCopy.none });
    for (const o of outcome.observations) {
      blocks.push({ kind: 'paragraph', text: questionText(o, insightCtx) });
      blocks.push({
        kind: 'paragraph',
        lead: R.insights.members,
        text: o.members.map((id) => names.of(id)).join(', '),
        small: true,
      });
      blocks.push({
        kind: 'paragraph',
        lead: R.insights.view,
        text: viewText(o.view, insightCtx),
        tone: 'graphite',
        small: true,
      });
    }
  }
  if (ctx.excludeSigned)
    blocks.push({ kind: 'paragraph', text: R.insights.leftOut, tone: 'graphite' });
  const caveats = insightCaveats(notes, ctx.excludeSigned);
  if (caveats)
    blocks.push({ kind: 'paragraph', lead: R.method.caveats, text: caveats, small: true });
  return blocks;
}

function methodSection(ctx: ExportContext, notes: string): Block[] {
  const blocks: Block[] = [{ kind: 'paragraph', text: R.method.intro, tone: 'graphite' }];
  for (const note of reportNotes(notes, ctx.excludeSigned)) {
    blocks.push({ kind: 'heading', text: note.heading });
    for (const p of note.paragraphs) blocks.push({ kind: 'paragraph', text: p });
    if (note.meaning)
      blocks.push({ kind: 'paragraph', lead: R.method.meaning, text: note.meaning });
    if (note.caveats)
      blocks.push({
        kind: 'paragraph',
        lead: R.method.caveats,
        text: note.caveats,
        tone: 'graphite',
      });
  }
  return blocks;
}

function coverageSection(ctx: ExportContext): Block[] {
  const C = R.coverage;
  const cov = ctx.result.coverage;
  const blocks: Block[] = [];
  if (!cov || !Number.isFinite(cov.rate)) {
    blocks.push({ kind: 'paragraph', text: coverageCopy.noData });
  } else {
    const rate = percent(cov.rate);
    const threshold = percent(cov.threshold);
    blocks.push(
      cov.belowThreshold
        ? { kind: 'warning', text: C.warning(rate, threshold) }
        : { kind: 'paragraph', text: C.fine(rate, threshold) },
    );
    blocks.push({ kind: 'paragraph', text: C.counts(cov.rated, cov.possible) });
    blocks.push({
      kind: 'table',
      columns: [
        { label: C.breakdown, numeric: false },
        { label: exportCopy.csv.value, numeric: true },
      ],
      rows: [
        [C.given, value(cov.rated)],
        [C.declined, value(cov.declined)],
        [C.notEntered, value(cov.notEntered)],
        [C.notApplicable, value(cov.notApplicable)],
        [C.possible, value(cov.possible)],
        [C.overall, rate],
      ],
    });
    blocks.push({ kind: 'paragraph', text: coverageCopy.explain, tone: 'graphite', small: true });

    // Raters below the threshold, lowest first.
    const low = cov.raters
      .filter((r) => Number.isFinite(r.rate) && r.rate < cov.threshold)
      .sort((a, b) => a.rate - b.rate || ctx.names.of(a.id).localeCompare(ctx.names.of(b.id)));
    blocks.push({ kind: 'paragraph', text: C.lowRaters(low.length, threshold) });
    if (low.length > 0) {
      blocks.push({
        kind: 'table',
        columns: [
          { label: C.rater, numeric: false },
          { label: C.rate, numeric: true },
        ],
        rows: low.map((r) => [ctx.names.of(r.id), percent(r.rate)]),
      });
    }
  }

  // Where the ratings came from, over the layers this report analyses.
  const enabled = new Set(ctx.project.layers.filter((l) => l.enabled).map((l) => l.key));
  const counts = { self_report: 0, imported: 0, entered: 0, none: 0 };
  for (const t of ctx.project.ties) {
    if (t.wave !== DEFAULT_WAVE || !enabled.has(t.variable)) continue;
    counts[t.source ?? 'none'] += 1;
  }
  const sources = (['self_report', 'imported', 'entered', 'none'] as const).filter(
    (k) => counts[k] > 0,
  );
  if (sources.length > 0) {
    blocks.push({ kind: 'heading', text: C.sources });
    blocks.push({
      kind: 'table',
      columns: [
        { label: C.source, numeric: false },
        { label: exportCopy.csv.value, numeric: true },
      ],
      rows: sources.map((k) => [coverageCopy.sources[k], value(counts[k])]),
    });
  }

  // Survey response rates (spec §14, Phase 7): read from the open project, since
  // they count people, not ratings.
  blocks.push({ kind: 'heading', text: C.surveys });
  const surveys = ctx.source.surveys;
  if (surveys.length === 0) blocks.push({ kind: 'paragraph', text: C.noSurveys });
  else {
    blocks.push({
      kind: 'table',
      columns: [
        { label: C.survey, numeric: false },
        { label: C.status, numeric: false },
        { label: C.issued, numeric: true },
        { label: C.responded, numeric: true },
        { label: C.rate2, numeric: true },
      ],
      rows: surveys.map((s) => {
        const st = surveyStatus(s);
        return [
          ctx.names.text(s.title),
          s.status === 'open' ? C.open : C.closed,
          value(st.issued),
          value(st.responded),
          st.issued === 0 ? R.metrics.notDefined : percent(st.rate),
        ];
      }),
    });
  }
  return blocks;
}

function ethicsSection(ctx: ExportContext): Block[] {
  return [
    ...R.ethics.paragraphs.map((text): Block => ({ kind: 'paragraph', text })),
    ...(ctx.anonymised ? [{ kind: 'paragraph' as const, text: R.ethics.anonymised }] : []),
    ...(ctx.excludeSigned ? [{ kind: 'paragraph' as const, text: R.ethics.excluded }] : []),
  ];
}

export function buildReport(
  ctx: ExportContext,
  options: { notes: string; now: Date; layerName: string },
): ReportModel {
  const { project, result } = ctx;
  const date = options.now.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const layers = project.layers.filter((l) => l.enabled && !isCategorical(l)).length;
  const view =
    result.view === 'directed'
      ? R.cover.directed
      : R.cover.symmetrised(exportCopy.csv.rules[result.symmetrise]);
  const cover = [
    R.cover.members(project.members.length, layers),
    R.cover.view(view),
    R.cover.weights(R.cover.presets[ctx.weightsPreset]),
    ctx.anonymised ? R.cover.anonymised : R.cover.named,
    ...(ctx.excludeSigned ? [ctx.reanalysed ? R.cover.excluded : R.cover.excludedNone] : []),
    R.cover.descriptive,
  ];
  const S = R.sections;
  const sections: ReportSection[] = [
    { title: S.metrics, blocks: metricsSection(ctx) },
    { title: S.insights, blocks: insightsSection(ctx, options.notes) },
    { title: S.method, blocks: methodSection(ctx, options.notes) },
    { title: S.coverage, blocks: coverageSection(ctx) },
    { title: S.ethics, blocks: ethicsSection(ctx) },
  ];
  return {
    title: ctx.names.text(project.meta.title),
    subtitle: R.cover.subtitle,
    date: R.cover.date(date),
    cover,
    contents: [S.map, ...sections.map((s) => s.title)],
    mapIntro: R.map.intro(options.layerName),
    sections,
  };
}

/** Every piece of text in the report model (tests check it for names and excluded layers). */
export function reportText(model: ReportModel): string[] {
  const out = [
    model.title,
    model.subtitle,
    model.date,
    ...model.cover,
    ...model.contents,
    model.mapIntro,
  ];
  for (const s of model.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if (b.kind === 'table') out.push(...b.columns.map((c) => c.label), ...b.rows.flat());
      else if (b.kind === 'paragraph') out.push(...(b.lead ? [b.lead] : []), b.text);
      else out.push(b.text);
    }
  }
  return out;
}
