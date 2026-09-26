import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { adjacencyCopy } from '../copy/adjacency';
import { formatWeight, mapCopy } from '../copy/map';
import { DIRECTED_METRICS, SYMMETRISED_METRICS, metricCopy } from '../copy/metrics';
import { groupAttributes } from '../map/model';
import { drawableLayers, memberGroups, type MapData } from '../map/useMapModel';
import { useAppStore, type SizeMetric } from '../state/store';

const A = adjacencyCopy;
const OVERSCAN = 4;

// Positions are integer indices passed to CSS as custom properties; the CSS
// multiplies them by the size tokens (the approach of the rating grid, D31).
const place = (name: string, value: number) => (el: HTMLElement | null) => {
  el?.style.setProperty(name, String(value));
};

/** Heat step for a tie weight: not rated, 0 (no tie), or 1–5 on the matrix ramp. */
export function heatClass(w: number): string {
  if (Number.isNaN(w)) return 'adjacency__cell--not-rated';
  if (w <= 0) return 'shade-0';
  return `shade-${String(Math.max(1, Math.min(5, Math.ceil(w * 5))))}`;
}

type SortKey = 'name' | 'community' | `attr:${string}` | `metric:${string}`;

// The adjacency matrix (spec §8): the tie weights of the layer the map draws,
// in the current view, one row and one column per member shown, heat-coded
// with the matrix ramp. Sortable by name, attribute, community or metric.
// Selection and the subgroup are shared with the map and the table.
export function AdjacencyView({ data }: { data: MapData }) {
  const { project, result, settings, model } = data;
  const setMap = useAppStore((s) => s.setMap);
  const [sort, setSort] = useState<SortKey>(settings.groupBy ? `attr:${settings.groupBy}` : 'name');
  const ids = { layer: useId(), sort: useId(), help: useId() };

  const ref = result.refs[settings.layer];
  const weights = ref?.weights;
  const n = project.members.length;
  const metrics = (result.view === 'directed' ? DIRECTED_METRICS : SYMMETRISED_METRICS).filter(
    (m) => ref?.node.columns[m] !== undefined,
  );
  const attrs = groupAttributes(project);
  const layerLabel = (key: string) =>
    key === 'composite'
      ? mapCopy.controls.composite
      : (project.layers.find((l) => l.key === key)?.label ?? key);

  // Row order: the members shown, sorted; group starts marked for attribute and community sorts.
  const { order, starts } = useMemo(() => {
    const visible = model.nodes.filter((node) => node.visible).map((node) => node.index);
    const name = (i: number) => project.members[i]?.display_name ?? '';
    let key: (i: number) => number = () => 0;
    let grouped = false;
    if (sort === 'community' && ref?.communities) {
      const c = ref.communities.membership;
      key = (i) => c[i] ?? 0;
      grouped = true;
    } else if (sort.startsWith('attr:')) {
      const { group } = memberGroups(project, sort.slice(5));
      key = (i) => group[i] ?? 0;
      grouped = true;
    } else if (sort.startsWith('metric:')) {
      const column = ref?.node.columns[sort.slice(7) as SizeMetric];
      // Highest first; values that are not defined last.
      key = (i) => {
        const v = column?.[i] ?? NaN;
        return Number.isFinite(v) ? -v : Infinity;
      };
    }
    const sorted = [...visible].sort(
      (a, b) => key(a) - key(b) || name(a).localeCompare(name(b), 'en-GB') || a - b,
    );
    const s = new Set<number>();
    if (grouped)
      sorted.forEach((i, k) => k > 0 && key(i) !== key(sorted[k - 1] as number) && s.add(k));
    return { order: sorted, starts: s };
  }, [model, project, ref, sort]);

  return (
    <div className="matrix adjacency">
      <div className="view-toolbar">
        <div className="field field--inline">
          <label htmlFor={ids.layer} className="field__label">
            {A.layer}
          </label>
          <select
            id={ids.layer}
            className="select"
            value={settings.layer}
            onChange={(e) => {
              setMap({ layer: e.currentTarget.value });
            }}
          >
            {drawableLayers(project, result).map((key) => (
              <option key={key} value={key}>
                {layerLabel(key)}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--inline">
          <label htmlFor={ids.sort} className="field__label">
            {A.sort}
          </label>
          <select
            id={ids.sort}
            className="select"
            value={sort}
            onChange={(e) => {
              setSort(e.currentTarget.value as SortKey);
            }}
          >
            <option value="name">{A.byName}</option>
            <optgroup label={A.attributes}>
              {attrs.map((a) => (
                <option key={a.key} value={`attr:${a.key}`}>
                  {a.label}
                </option>
              ))}
            </optgroup>
            {ref?.communities && <option value="community">{A.community}</option>}
            <optgroup label={A.metrics}>
              {metrics.map((m) => (
                <option key={m} value={`metric:${m}`}>
                  {metricCopy[m].label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>
      <ul className="matrix-key" aria-label={A.key}>
        <li>
          <span className="matrix-key__swatch adjacency__cell--not-rated" aria-hidden="true" />
          {A.notRated}
        </li>
        <li>
          <span className="matrix-key__swatch shade-0" aria-hidden="true" />
          {A.zero}
        </li>
        <li>
          <span className="matrix-key__ramp" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((v) => (
              <span key={v} className={`matrix-key__step shade-${String(v)}`} />
            ))}
          </span>
          <span className="num">{A.ramp}</span>
        </li>
        <li>{result.view === 'directed' ? A.directed : A.symmetrised}</li>
      </ul>
      <p className="matrix__help" id={ids.help}>
        {A.help}
      </p>
      {order.length === 0 || !weights ? (
        <p className="placeholder">{A.noMembers}</p>
      ) : (
        <AdjacencyGrid
          key={`${settings.layer}|${sort}`}
          data={data}
          order={order}
          starts={starts}
          weights={weights}
          n={n}
          helpId={ids.help}
          layer={layerLabel(settings.layer)}
        />
      )}
    </div>
  );
}

interface GridProps {
  data: MapData;
  order: number[];
  starts: ReadonlySet<number>;
  weights: Float64Array;
  n: number;
  helpId: string;
  layer: string;
}

function AdjacencyGrid({ data, order, starts, weights, n, helpId, layer }: GridProps) {
  const { project, model } = data;
  const selected = useAppStore((s) => s.selection.member);
  const group = useAppStore((s) => s.selection.group);
  const selectMember = useAppStore((s) => s.selectMember);
  const toggleGroupMember = useAppStore((s) => s.toggleGroupMember);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const baseId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState({ size: 0, labelW: 0, headerH: 0 });
  const [view, setView] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const m = order.length;
  const indexOfMember = useMemo(
    () => new Map(project.members.map((mm, i) => [mm.id, i])),
    [project],
  );
  const selectedRow = selected === null ? -1 : order.indexOf(indexOfMember.get(selected) ?? -2);
  const [active, setActive] = useState({ r: Math.max(0, selectedRow), c: 0 });
  const inGroup = new Set(group);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!viewport || !grid) return;
    const style = getComputedStyle(grid);
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
    setCell({
      size: px('--adjacency-cell'),
      labelW: px('--matrix-label-width'),
      headerH: px('--matrix-header-height'),
    });
    const measure = () => {
      setView({
        top: viewport.scrollTop,
        left: viewport.scrollLeft,
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, []);

  // A selection made in another view moves the active row here and brings it into view.
  const [previous, setPrevious] = useState(selectedRow);
  if (previous !== selectedRow) {
    setPrevious(selectedRow);
    if (selectedRow >= 0) setActive((a) => ({ ...a, r: selectedRow }));
  }
  useEffect(() => {
    if (selectedRow >= 0) scrollIntoView(selectedRow, -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow]);

  const range = (start: number, span: number, size: number) => {
    if (size <= 0) return [0, Math.min(m, 40) - 1] as const;
    const first = Math.max(0, Math.floor(start / size) - OVERSCAN);
    const last = Math.min(m - 1, Math.ceil((start + span) / size) + OVERSCAN);
    return [first, last] as const;
  };
  const [r0, r1] = range(view.top, view.height - cell.headerH, cell.size);
  const [c0, c1] = range(view.left, view.width - cell.labelW, cell.size);
  const rows = new Set<number>();
  for (let r = r0; r <= r1; r++) rows.add(r);
  rows.add(active.r);
  if (selectedRow >= 0) rows.add(selectedRow);
  const cols = new Set<number>();
  for (let c = c0; c <= c1; c++) cols.add(c);
  cols.add(active.c);
  if (selectedRow >= 0) cols.add(selectedRow);
  const rowList = [...rows].filter((r) => r < m).sort((a, b) => a - b);
  const colList = [...cols].filter((c) => c < m).sort((a, b) => a - b);

  const name = (k: number) => project.members[order[k] ?? -1]?.display_name ?? '';
  const idAt = (k: number) => project.members[order[k] ?? -1]?.id ?? '';
  const cellId = (r: number, c: number) => `${baseId}-r${String(r)}c${String(c)}`;
  const weight = (r: number, c: number) => {
    const i = order[r] as number;
    const j = order[c] as number;
    return i === j ? NaN : (weights[i * n + j] as number);
  };
  const hue = (k: number) => {
    const g = model.fill.groups[model.nodes[order[k] ?? -1]?.group ?? -1];
    return g && g.hue >= 0 ? `legend__dot--cat-${String(g.hue + 1)}` : 'legend__dot--other';
  };

  function scrollIntoView(r: number, c: number) {
    const viewport = viewportRef.current;
    if (!viewport || cell.size === 0) return;
    const bodyH = viewport.clientHeight - cell.headerH;
    const bodyW = viewport.clientWidth - cell.labelW;
    const top = r * cell.size;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + cell.size > viewport.scrollTop + bodyH)
      viewport.scrollTop = top + cell.size - bodyH;
    if (c < 0) return;
    const left = c * cell.size;
    if (left < viewport.scrollLeft) viewport.scrollLeft = left;
    else if (left + cell.size > viewport.scrollLeft + bodyW)
      viewport.scrollLeft = left + cell.size - bodyW;
  }

  function moveTo(r: number, c: number) {
    const next = { r: Math.max(0, Math.min(m - 1, r)), c: Math.max(0, Math.min(m - 1, c)) };
    setActive(next);
    scrollIntoView(next.r, next.c);
  }

  const choose = (k: number, toggle: boolean) => {
    const id = idAt(k);
    if (!id) return;
    if (toggle) {
      toggleGroupMember(id);
      return;
    }
    selectMember(id);
    setRightPanel('member');
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const page = cell.size > 0 ? Math.max(1, Math.floor(view.height / cell.size) - 2) : 10;
    const ctrl = e.ctrlKey || e.metaKey;
    const moves: Record<string, [number, number] | undefined> = {
      ArrowUp: [active.r - 1, active.c],
      ArrowDown: [active.r + 1, active.c],
      ArrowLeft: [active.r, active.c - 1],
      ArrowRight: [active.r, active.c + 1],
      PageUp: [active.r - page, active.c],
      PageDown: [active.r + page, active.c],
      Home: ctrl ? [0, 0] : [active.r, 0],
      End: ctrl ? [m - 1, m - 1] : [active.r, m - 1],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      moveTo(move[0], move[1]);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active.r, e.shiftKey);
    }
  }

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!target) return;
    const r = Number(target.dataset.r);
    const c = target.dataset.c === undefined ? active.c : Number(target.dataset.c);
    setActive({ r, c });
    choose(r, e.shiftKey);
    gridRef.current?.focus();
  }

  const w = weight(active.r, active.c);
  const readout =
    active.r === active.c
      ? A.self(name(active.r))
      : A.readout(
          name(active.r),
          name(active.c),
          Number.isNaN(w) ? A.notRated : w > 0 ? formatWeight(w) : A.noTie,
          data.result.view === 'directed',
        );

  return (
    <>
      <div
        className="matrix__viewport"
        ref={viewportRef}
        onScroll={(e) => {
          const v = e.currentTarget;
          setView((prev) => ({ ...prev, top: v.scrollTop, left: v.scrollLeft }));
        }}
      >
        {/* The grid is operated from the keyboard through aria-activedescendant. */}
        <div
          ref={(el) => {
            gridRef.current = el;
            place('--rows', m)(el);
            place('--cols', m)(el);
          }}
          role="grid"
          aria-readonly="true"
          aria-label={A.gridLabel(layer)}
          aria-describedby={helpId}
          aria-rowcount={m + 1}
          aria-colcount={m + 1}
          aria-activedescendant={cellId(active.r, active.c)}
          tabIndex={0}
          className="adjacency__grid"
          onKeyDown={onKeyDown}
          onClick={onClick}
          data-testid="adjacency-grid"
        >
          <div role="row" aria-rowindex={1} className="matrix__header-row">
            <div role="columnheader" aria-colindex={1} className="matrix__corner">
              {A.corner(data.result.view === 'directed')}
            </div>
            {colList.map((c) => (
              <div
                key={c}
                ref={place('--c', c)}
                role="columnheader"
                aria-colindex={c + 2}
                className={[
                  'adjacency__col-header',
                  c === active.c ? 'is-active' : '',
                  c === selectedRow ? 'is-selected' : '',
                  inGroup.has(idAt(c)) ? 'is-grouped' : '',
                  starts.has(c) ? 'starts-group' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={name(c)}
              >
                <span className="matrix__col-label">{name(c)}</span>
              </div>
            ))}
          </div>
          {rowList.map((r) => (
            <div
              key={r}
              ref={place('--r', r)}
              role="row"
              aria-rowindex={r + 2}
              aria-selected={r === selectedRow}
              className={[
                'adjacency__row',
                r === selectedRow ? 'is-selected' : '',
                starts.has(r) ? 'starts-group' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div
                role="rowheader"
                aria-colindex={1}
                data-r={r}
                className={[
                  'adjacency__row-header',
                  r === active.r ? 'is-active' : '',
                  inGroup.has(idAt(r)) ? 'is-grouped' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={name(r)}
              >
                <span className={`legend__dot ${hue(r)}`} aria-hidden="true" />
                <span className="adjacency__name">{name(r)}</span>
                {inGroup.has(idAt(r)) && <span className="visually-hidden">{A.inGroup}</span>}
              </div>
              {colList.map((c) => {
                const v = weight(r, c);
                const self = r === c;
                return (
                  <div
                    key={c}
                    ref={place('--c', c)}
                    id={cellId(r, c)}
                    role="gridcell"
                    aria-colindex={c + 2}
                    data-r={r}
                    data-c={c}
                    className={[
                      'adjacency__cell',
                      self ? 'adjacency__cell--self' : heatClass(v),
                      r === active.r && c === active.c ? 'is-active' : '',
                      c === selectedRow || r === selectedRow ? 'is-crossed' : '',
                      starts.has(c) ? 'starts-group-col' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="visually-hidden">
                      {self
                        ? A.selfShort
                        : Number.isNaN(v)
                          ? A.notRated
                          : v > 0
                            ? formatWeight(v)
                            : A.noTie}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="matrix__position num" aria-live="polite">
        {readout}
      </p>
    </>
  );
}
