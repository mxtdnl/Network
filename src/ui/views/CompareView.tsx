import { useId, useMemo, useState } from 'react';
import { FI_CLASS, OVERLAP, tieOverlap } from '../engineClient';
import { compareCopy } from '../copy/compare';
import { percent } from '../copy/data';
import { formatValue, formatWeight, mapCopy } from '../copy/map';
import {
  buildMapModel,
  refLabel,
  roleLayer,
  type EdgeStyle,
  type MapEdge,
  type MapModel,
} from '../map/model';
import { useMapData, type MapData } from '../map/useMapModel';
import { useAppStore, type CompareMode } from '../state/store';
import { EmptyState } from './EmptyState';
import { MiniMap } from './MiniMap';

const C = compareCopy;
const MODES: readonly CompareMode[] = ['layers', 'formalInformal'];

// Side-by-side comparison (spec §8) and the formal–informal comparison
// (spec §6): small maps on the map's own positions, with the counts beside
// them. Selection, hover and the subgroup are shared with every view.
export function CompareView() {
  const project = useAppStore((s) => s.data.project);
  const mode = useAppStore((s) => s.ui.compareMode);
  const setMode = useAppStore((s) => s.setCompareMode);
  const data = useMapData();
  const name = useId();
  if (!project || project.members.length === 0) return <EmptyState />;
  if (!data) return <p className="placeholder">{mapCopy.calculating}</p>;
  return (
    <div className="compare">
      <fieldset className="view-toolbar view-toolbar--modes">
        <legend className="visually-hidden">{C.mode}</legend>
        <div className="segmented">
          {MODES.map((m) => (
            <label key={m} className="segmented__option">
              <input
                type="radio"
                className="segmented__input"
                name={`${name}-mode`}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                }}
              />
              <span className="segmented__label">{C.modes[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {mode === 'layers' ? <LayerComparison data={data} /> : <FormalInformal data={data} />}
    </div>
  );
}

/** Layers that can be compared: the composite, unsigned layers and the two sides of signed layers. */
function comparableRefs(data: MapData): string[] {
  const { project, result } = data;
  const order = new Map(project.layers.map((l, i) => [l.key, i]));
  const base = (ref: string) => (ref.endsWith('+') || ref.endsWith('-') ? ref.slice(0, -1) : ref);
  return result.refOrder
    .filter((r) => result.refs[r] !== undefined)
    .sort((a, b) =>
      a === 'composite'
        ? -1
        : b === 'composite'
          ? 1
          : (order.get(base(a)) ?? 0) - (order.get(base(b)) ?? 0) || a.localeCompare(b),
    );
}

function labelOf(data: MapData, ref: string): string {
  if (ref === 'composite') return mapCopy.controls.composite;
  const label = refLabel(data.project, ref);
  if (ref.endsWith('+')) return C.positive(label);
  if (ref.endsWith('-')) return C.negative(label);
  return label;
}

/** The linked model with ties from another layer, sized by the same metric where that layer has it. */
function modelFor(data: MapData, ref: string): MapModel {
  const columns = data.result.refs[ref]?.node.columns ?? {};
  const sizeMetric =
    data.settings.sizeMetric in columns
      ? data.settings.sizeMetric
      : ((Object.keys(columns)[0] as typeof data.settings.sizeMetric | undefined) ??
        data.settings.sizeMetric);
  return buildMapModel(
    data.project,
    data.result,
    { ...data.settings, layer: ref, sizeMetric },
    data.theme,
  );
}

function LayerComparison({ data }: { data: MapData }) {
  const refs = comparableRefs(data);
  const formal = roleLayer(data.project, 'formal')?.key;
  const informal = roleLayer(data.project, 'informal')?.key;
  const defaults =
    formal && informal && refs.includes(formal) && refs.includes(informal)
      ? [formal, informal]
      : [refs[0] ?? '', refs[1] ?? refs[0] ?? ''];
  const [left, setLeft] = useState(defaults[0] as string);
  const [right, setRight] = useState(defaults[1] as string);
  const [perMember, setPerMember] = useState(false);
  const ids = { left: useId(), right: useId(), table: useId() };
  const a = refs.includes(left) ? left : (defaults[0] as string);
  const b = refs.includes(right) ? right : (defaults[1] as string);

  const models = useMemo(
    () => (refs.length < 2 ? null : ([modelFor(data, a), modelFor(data, b)] as const)),
    [data, a, b, refs.length],
  );
  const overlap = useMemo(() => {
    const wa = data.result.refs[a]?.weights;
    const wb = data.result.refs[b]?.weights;
    return wa && wb
      ? tieOverlap(wa, wb, data.project.members.length, data.result.view === 'directed')
      : null;
  }, [data, a, b]);

  if (refs.length < 2 || !models) return <p className="placeholder">{C.noLayers}</p>;
  const la = labelOf(data, a);
  const lb = labelOf(data, b);
  const na = data.result.refs[a]?.network;
  const nb = data.result.refs[b]?.network;
  const comps = (x: typeof na) =>
    x ? (x.components.weak?.length ?? x.components.connected?.length ?? NaN) : NaN;
  const ca = data.result.refs[a]?.communities;
  const cb = data.result.refs[b]?.communities;
  const rows: [string, string, string][] = [
    [C.ties, formatValue(na?.ties ?? NaN), formatValue(nb?.ties ?? NaN)],
    [C.density, formatWeight(na?.density ?? NaN), formatWeight(nb?.density ?? NaN)],
    [
      C.reciprocity,
      percent(na?.reciprocity.overall ?? NaN),
      percent(nb?.reciprocity.overall ?? NaN),
    ],
    [C.components, formatValue(comps(na)), formatValue(comps(nb))],
    [C.communities, formatValue(ca?.count ?? NaN), formatValue(cb?.count ?? NaN)],
  ];

  const select = (id: string, value: string, onChange: (v: string) => void, text: string) => (
    <div className="field field--inline">
      <label htmlFor={id} className="field__label">
        {text}
      </label>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
      >
        {refs.map((r) => (
          <option key={r} value={r}>
            {labelOf(data, r)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <div className="view-toolbar">
        {select(ids.left, a, setLeft, C.left)}
        {select(ids.right, b, setRight, C.right)}
      </div>
      <p className="field__help compare__intro">{C.sameLayout}</p>
      <div className="compare__maps compare__maps--two">
        <MiniMap data={data} model={models[0]} label={la} />
        <MiniMap data={data} model={models[1]} label={lb} />
      </div>
      <div className="compare__tables">
        <table className="member__table compare__table">
          <thead>
            <tr>
              <th scope="col">{C.measure}</th>
              <th scope="col" className="numeric">
                {la}
              </th>
              <th scope="col" className="numeric">
                {lb}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, x, y]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className="numeric">{x}</td>
                <td className="numeric">{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {overlap && (
          <table className="member__table compare__table" data-testid="layer-overlap">
            <caption className="field__label compare__caption">{C.overlap}</caption>
            <tbody>
              <tr>
                <th scope="row">{C.both}</th>
                <td className="numeric">{formatValue(overlap.both)}</td>
              </tr>
              <tr>
                <th scope="row">{C.leftOnly(la)}</th>
                <td className="numeric">{formatValue(overlap.firstOnly)}</td>
              </tr>
              <tr>
                <th scope="row">{C.rightOnly(lb)}</th>
                <td className="numeric">{formatValue(overlap.secondOnly)}</td>
              </tr>
              <tr>
                <th scope="row">{C.jaccard}</th>
                <td className="numeric">{percent(overlap.jaccard)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {overlap && <p className="field__help compare__note">{C.jaccardHelp}</p>}
      </div>
      {overlap && (
        <section className="compare__members">
          <button
            type="button"
            className="member__disclosure"
            aria-expanded={perMember}
            aria-controls={ids.table}
            onClick={() => {
              setPerMember((p) => !p);
            }}
          >
            {perMember ? C.hidePerMember : C.showPerMember}
          </button>
          <div id={ids.table} hidden={!perMember}>
            {perMember && (
              <PerMemberTable
                data={data}
                columns={[la, lb, C.shared]}
                counts={(i, j) => {
                  const c = overlap.classes[i * data.project.members.length + j] ?? 0;
                  return [
                    c === OVERLAP.firstOnly || c === OVERLAP.both,
                    c === OVERLAP.secondOnly || c === OVERLAP.both,
                    c === OVERLAP.both,
                  ];
                }}
              />
            )}
          </div>
        </section>
      )}
    </>
  );
}

/** One row per member shown: how many pairs involving them fall in each column. */
function PerMemberTable({
  data,
  columns,
  counts,
}: {
  data: MapData;
  columns: string[];
  counts: (i: number, j: number) => boolean[];
}) {
  const selected = useAppStore((s) => s.selection.member);
  const selectMember = useAppStore((s) => s.selectMember);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const { model } = data;
  const directed = data.result.view === 'directed';
  const rows = useMemo(() => {
    const visible = model.nodes.filter((x) => x.visible);
    return visible
      .map((node) => {
        const totals = columns.map(() => 0);
        for (const other of visible) {
          const j = other.index;
          if (j === node.index) continue;
          const pairs = directed
            ? [counts(node.index, j), counts(j, node.index)]
            : [counts(Math.min(node.index, j), Math.max(node.index, j))];
          for (const flags of pairs)
            flags.forEach((f, k) => f && (totals[k] = (totals[k] ?? 0) + 1));
        }
        return { node, totals };
      })
      .sort((p, q) => p.node.name.localeCompare(q.node.name, 'en-GB'));
  }, [model, columns, counts, directed]);
  return (
    <table className="member__table compare__per-member">
      <thead>
        <tr>
          <th scope="col">{C.member}</th>
          {columns.map((c) => (
            <th key={c} scope="col" className="numeric">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ node, totals }) => (
          <tr key={node.id} className={node.id === selected ? 'is-selected' : undefined}>
            <th scope="row">
              <button
                type="button"
                className="link-button"
                aria-current={node.id === selected ? 'true' : undefined}
                onClick={() => {
                  selectMember(node.id);
                  setRightPanel('member');
                }}
              >
                {node.name}
              </button>
            </th>
            {totals.map((t, k) => (
              <td key={columns[k]} className="numeric">
                {formatValue(t)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const FI_ORDER = [
  { cls: FI_CLASS.formalOnly, key: 'formalOnly', style: 'formal' },
  { cls: FI_CLASS.informalOnly, key: 'informalOnly', style: 'informal' },
  { cls: FI_CLASS.both, key: 'both', style: 'both' },
] as const;

/** The linked model with only the pairs of one formal–informal class, drawn in that class's line style. */
function classModel(data: MapData, classes: Uint8Array, cls: number, style: EdgeStyle): MapModel {
  const { model, theme } = data;
  const n = model.n;
  const directed = model.directed;
  const edges: MapEdge[] = [];
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  const width = (theme.edgeMin + theme.edgeMax) / 2;
  for (let i = 0; i < n; i++) {
    if (!model.nodes[i]?.visible) continue;
    for (let j = directed ? 0 : i + 1; j < n; j++) {
      if (i === j || !model.nodes[j]?.visible || classes[i * n + j] !== cls) continue;
      edges.push({
        source: i,
        target: j,
        weight: 1,
        width,
        valence: NaN,
        style,
        reciprocated: directed && classes[j * n + i] === cls,
      });
      if (!(neighbours[i] as number[]).includes(j)) (neighbours[i] as number[]).push(j);
      if (!(neighbours[j] as number[]).includes(i)) (neighbours[j] as number[]).push(i);
    }
  }
  return {
    ...model,
    edges,
    neighbours,
    valenceShown: false,
    styleShown: true,
    stylesPresent: [style],
  };
}

function FormalInformal({ data }: { data: MapData }) {
  const fi = data.result.multiplex?.formalInformal ?? null;
  const models = useMemo(
    () => (fi ? FI_ORDER.map((o) => classModel(data, fi.classes, o.cls, o.style)) : null),
    [data, fi],
  );
  const [perMember, setPerMember] = useState(false);
  const tableId = useId();
  if (!fi || !models) return <p className="placeholder">{C.fi.unavailable}</p>;
  const { counts } = fi;
  const tied = counts.formalOnly + counts.informalOnly + counts.both;
  const rows = [
    { label: C.fi.formalOnly, n: counts.formalOnly, share: true },
    { label: C.fi.informalOnly, n: counts.informalOnly, share: true },
    { label: C.fi.both, n: counts.both, share: true },
    { label: C.fi.neither, n: counts.neither, share: false },
    { label: C.fi.notClassified, n: counts.notClassified, share: false },
  ];
  const n = data.project.members.length;
  return (
    <>
      <p className="field__help compare__intro">{C.fi.intro}</p>
      <div className="compare__maps compare__maps--three">
        {FI_ORDER.map((o, k) => (
          <MiniMap
            key={o.key}
            data={data}
            model={models[k] as MapModel}
            label={C.fi.mapLabel(C.fi[o.key], counts[o.key])}
          />
        ))}
      </div>
      <h3 id={`${tableId}-caption`} className="compare__heading">
        {C.fi.caption(data.result.view === 'directed')}
      </h3>
      <table
        className="member__table compare__table"
        aria-labelledby={`${tableId}-caption`}
        data-testid="formal-informal-counts"
      >
        <thead>
          <tr>
            <th scope="col">{C.fi.class}</th>
            <th scope="col" className="numeric">
              {C.fi.count}
            </th>
            <th scope="col" className="numeric">
              {C.fi.share}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td className="numeric">{formatValue(r.n)}</td>
              <td className="numeric">{r.share && tied > 0 ? percent(r.n / tied) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="compare__members">
        <button
          type="button"
          className="member__disclosure"
          aria-expanded={perMember}
          aria-controls={tableId}
          onClick={() => {
            setPerMember((p) => !p);
          }}
        >
          {perMember ? C.hidePerMember : C.showPerMember}
        </button>
        <div id={tableId} hidden={!perMember}>
          {perMember && (
            <PerMemberTable
              data={data}
              columns={[C.fi.formalOnly, C.fi.informalOnly, C.fi.both]}
              counts={(i, j) => {
                const c = fi.classes[i * n + j];
                return [
                  c === FI_CLASS.formalOnly,
                  c === FI_CLASS.informalOnly,
                  c === FI_CLASS.both,
                ];
              }}
            />
          )}
        </div>
      </section>
    </>
  );
}
