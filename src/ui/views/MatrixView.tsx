import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  categoryCodes,
  cellState,
  layerIndex,
  pairKey,
  parseClipboardGrid,
  parseRatingInput,
  planPaste,
  type CellState,
} from '../../data/ratings';
import type { LayerDefinition, Member, Tie } from '../../data/schema';
import { matrixCopy } from '../copy/data';
import { useMemberNames } from '../state/names';
import { useAppStore } from '../state/store';

// Rows and columns rendered beyond the visible area, so fast scrolling does not
// show blank space.
const OVERSCAN = 4;

interface Sizes {
  cellW: number;
  cellH: number;
  labelW: number;
  headerH: number;
}

// Cell geometry comes from tokens.css (--matrix-*), read once from the grid.
function readSizes(el: Element): Sizes {
  const style = getComputedStyle(el);
  const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    cellW: px('--matrix-cell-width'),
    cellH: px('--matrix-cell-height'),
    labelW: px('--matrix-label-width'),
    headerH: px('--matrix-header-height'),
  };
}

// Positions are integer indices passed to CSS as custom properties; the CSS
// multiplies them by the size tokens. No design value is set from script.
const place = (name: string, value: number) => (el: HTMLElement | null) => {
  el?.style.setProperty(name, String(value));
};

const MINUS = '−';

export function formatRating(layer: LayerDefinition, value: number | string): string {
  if (typeof value === 'string') return categoryCodes(layer).get(value) ?? value;
  const text = String(Math.abs(value));
  if (!layer.signed || value === 0) return value < 0 ? `${MINUS}${text}` : text;
  return value > 0 ? `+${text}` : `${MINUS}${text}`;
}

/** Shade class for a rated value: a step of the matrix ramp, or of the valence scale. */
export function shadeClass(layer: LayerDefinition, value: number | string): string {
  if (typeof value === 'string') return '';
  if (layer.signed) {
    const step = Math.max(-3, Math.min(3, Math.round((value / Math.max(layer.max, 1)) * 3)));
    return `shade-signed-${step < 0 ? `n${String(-step)}` : step > 0 ? `p${String(step)}` : '0'}`;
  }
  const r = (value - layer.min) / (layer.max - layer.min);
  return `shade-${String(Math.max(0, Math.min(5, Math.round(r * 5))))}`;
}

function inputText(tie: Tie | undefined): string {
  if (!tie || tie.value === null) return '';
  return String(tie.value);
}

export function MatrixView() {
  const project = useAppStore((s) => s.data.project);
  const matrixLayer = useAppStore((s) => s.data.matrixLayer);
  const setMatrixLayer = useAppStore((s) => s.setMatrixLayer);
  const selectId = useId();

  if (!project || project.members.length === 0) {
    return <p className="placeholder">{matrixCopy.noMembers}</p>;
  }
  const enabled = project.layers.filter((l) => l.enabled);
  const layer = enabled.find((l) => l.key === matrixLayer) ?? enabled[0];
  if (!layer) return <p className="placeholder">{matrixCopy.noLayers}</p>;

  return (
    <div className="matrix">
      <div className="matrix__toolbar">
        <div className="field field--inline">
          <label htmlFor={selectId} className="field__label">
            {matrixCopy.layer}
          </label>
          <select
            id={selectId}
            className="select"
            value={layer.key}
            onChange={(e) => {
              setMatrixLayer(e.currentTarget.value);
            }}
          >
            {enabled.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <p className="matrix__question">{layer.question_wording}</p>
      </div>
      <MatrixKey layer={layer} />
      <p className="matrix__help" id={`${selectId}-help`}>
        {matrixCopy.help}
      </p>
      <MatrixGrid
        key={layer.key}
        layer={layer}
        members={project.members}
        ties={project.ties}
        helpId={`${selectId}-help`}
      />
    </div>
  );
}

function MatrixKey({ layer }: { layer: LayerDefinition }) {
  const scale = layer.scale_labels ?? {};
  const scaleEntries = Object.entries(scale).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <div className="matrix__key">
      <ul className="matrix-key" aria-label={matrixCopy.keyHeading}>
        <li>
          <span className="matrix-key__swatch matrix__cell--not-rated" aria-hidden="true" />
          {matrixCopy.keyNotRated}
        </li>
        <li>
          <span className="matrix-key__swatch matrix__cell--not-applicable" aria-hidden="true">
            {matrixCopy.naMark}
          </span>
          {matrixCopy.keyNotApplicable}
        </li>
        {layer.scale_type !== 'categorical' && (
          <li>
            <span className="matrix-key__swatch matrix-key__swatch--zero" aria-hidden="true">
              0
            </span>
            {matrixCopy.keyZero}
          </li>
        )}
        {layer.scale_type !== 'categorical' && (
          <li>
            <span className="matrix-key__ramp" aria-hidden="true">
              {(layer.signed ? [-3, -2, -1, 1, 2, 3] : [1, 2, 3, 4, 5]).map((v) => (
                <span key={v} className={`matrix-key__step ${shadeClass(layer, v)}`} />
              ))}
            </span>
            {matrixCopy.keyValue}
          </li>
        )}
        <li>
          <span className="matrix-key__swatch matrix__cell--self" aria-hidden="true" />
          {matrixCopy.keySelf}
        </li>
      </ul>
      <p className="matrix__scale num">
        {layer.scale_type === 'categorical'
          ? `${matrixCopy.categoryKey}: ${[...categoryCodes(layer)]
              .map(([c, code]) => `${code} ${layer.category_labels?.[c] ?? c}`)
              .join(', ')}`
          : `${matrixCopy.scaleNote(formatRating(layer, layer.min), formatRating(layer, layer.max))}${scaleEntries.length > 0 ? ': ' : ''}${scaleEntries
              .map(([v, label]) => `${formatRating(layer, Number(v))} ${label}`)
              .join(', ')}`}
      </p>
    </div>
  );
}

interface GridProps {
  layer: LayerDefinition;
  members: Member[];
  ties: Tie[];
  helpId: string;
}

interface Editing {
  text: string;
  error: string | null;
}

function MatrixGrid({ layer, members, ties, helpId }: GridProps) {
  const names = useMemberNames();
  const applyRatings = useAppStore((s) => s.applyRatings);
  const baseId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sizes, setSizes] = useState<Sizes | null>(null);
  const [view, setView] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [active, setActive] = useState({ r: 0, c: 1 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [message, setMessage] = useState('');

  const n = members.length;
  // Rebuilt when the ties array changes; the store replaces it on every edit.
  const index = useMemo(() => layerIndex(ties, layer.key), [ties, layer.key]);
  const tieAt = useCallback(
    (r: number, c: number) => {
      const a = members[r];
      const b = members[c];
      return a && b ? index.get(pairKey(a.id, b.id)) : undefined;
    },
    [index, members],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const grid = gridRef.current;
    if (!viewport || !grid) return;
    setSizes(readSizes(grid));
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

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const range = (start: number, span: number, size: number) => {
    if (size <= 0) return [0, Math.min(n, 30) - 1] as const;
    const first = Math.max(0, Math.floor(start / size) - OVERSCAN);
    const last = Math.min(n - 1, Math.ceil((start + span) / size) + OVERSCAN);
    return [first, last] as const;
  };
  const [r0, r1] = range(view.top, view.height - (sizes?.headerH ?? 0), sizes?.cellH ?? 0);
  const [c0, c1] = range(view.left, view.width - (sizes?.labelW ?? 0), sizes?.cellW ?? 0);
  const rows = new Set<number>();
  for (let r = r0; r <= r1; r += 1) rows.add(r);
  rows.add(active.r);
  const cols = new Set<number>();
  for (let c = c0; c <= c1; c += 1) cols.add(c);
  cols.add(active.c);
  const rowList = [...rows].sort((a, b) => a - b);
  const colList = [...cols].sort((a, b) => a - b);

  const cellId = (r: number, c: number) => `${baseId}-r${String(r)}c${String(c)}`;

  function scrollIntoView(r: number, c: number) {
    const viewport = viewportRef.current;
    if (!viewport || !sizes) return;
    const top = r * sizes.cellH;
    const left = c * sizes.cellW;
    const bodyH = viewport.clientHeight - sizes.headerH;
    const bodyW = viewport.clientWidth - sizes.labelW;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + sizes.cellH > viewport.scrollTop + bodyH)
      viewport.scrollTop = top + sizes.cellH - bodyH;
    if (left < viewport.scrollLeft) viewport.scrollLeft = left;
    else if (left + sizes.cellW > viewport.scrollLeft + bodyW)
      viewport.scrollLeft = left + sizes.cellW - bodyW;
  }

  function moveTo(r: number, c: number) {
    const next = { r: Math.max(0, Math.min(n - 1, r)), c: Math.max(0, Math.min(n - 1, c)) };
    setActive(next);
    scrollIntoView(next.r, next.c);
  }

  function isSelf(r: number, c: number) {
    return r === c;
  }

  function startEditing(text: string) {
    if (isSelf(active.r, active.c)) {
      setMessage(matrixCopy.selfBlocked);
      return;
    }
    setEditing({ text, error: null });
  }

  function commit(then: { dr: number; dc: number } | null): boolean {
    if (!editing) return true;
    const rater = members[active.r];
    const ratee = members[active.c];
    if (!rater || !ratee) return true;
    const parsed = parseRatingInput(layer, editing.text);
    if (parsed.kind === 'error') {
      const error =
        parsed.code === 'unknown_category'
          ? matrixCopy.invalidCategory(
              editing.text,
              [...categoryCodes(layer)]
                .map(([c, code]) => `${code} (${layer.category_labels?.[c] ?? c})`)
                .join(', '),
            )
          : matrixCopy.invalid(editing.text, layer.min, layer.max);
      setEditing({ ...editing, error });
      return false;
    }
    if (parsed.kind === 'clear') {
      if (tieAt(active.r, active.c)) {
        applyRatings(layer.key, [{ rater: rater.id, ratee: ratee.id, kind: 'clear' }]);
      }
    } else if (parsed.kind === 'not_applicable') {
      applyRatings(layer.key, [{ rater: rater.id, ratee: ratee.id, kind: 'not_applicable' }]);
    } else {
      applyRatings(layer.key, [
        { rater: rater.id, ratee: ratee.id, kind: 'set', value: parsed.value },
      ]);
    }
    setEditing(null);
    setMessage('');
    if (then) moveTo(active.r + then.dr, active.c + then.dc);
    gridRef.current?.focus();
    return true;
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (editing) return;
    const page =
      sizes && sizes.cellH > 0 ? Math.max(1, Math.floor(view.height / sizes.cellH) - 2) : 10;
    const ctrl = e.ctrlKey || e.metaKey;
    const moves: Record<string, [number, number] | undefined> = {
      ArrowUp: [active.r - 1, active.c],
      ArrowDown: [active.r + 1, active.c],
      ArrowLeft: [active.r, active.c - 1],
      ArrowRight: [active.r, active.c + 1],
      PageUp: [active.r - page, active.c],
      PageDown: [active.r + page, active.c],
      Home: ctrl ? [0, 0] : [active.r, 0],
      End: ctrl ? [n - 1, n - 1] : [active.r, n - 1],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      moveTo(move[0], move[1]);
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEditing(inputText(tieAt(active.r, active.c)));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const rater = members[active.r];
      const ratee = members[active.c];
      if (rater && ratee && !isSelf(active.r, active.c) && tieAt(active.r, active.c)) {
        applyRatings(layer.key, [{ rater: rater.id, ratee: ratee.id, kind: 'clear' }]);
      }
      return;
    }
    if (e.key.length === 1 && !ctrl && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      startEditing(e.key);
    }
  }

  function onEditorKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit({ dr: 1, dc: 0 });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditing(null);
      gridRef.current?.focus();
    }
  }

  function cellFromEvent(e: MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!target) return null;
    return { r: Number(target.dataset.r), c: Number(target.dataset.c) };
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (editing) return;
    e.preventDefault();
    const grid = parseClipboardGrid(e.clipboardData.getData('text/plain'));
    const plan = planPaste(
      layer,
      members.map((m) => m.id),
      active.r,
      active.c,
      grid,
    );
    if (plan.changes.length > 0) applyRatings(layer.key, plan.changes);
    let text = matrixCopy.pasted(plan.set, plan.cleared);
    const first = plan.skipped[0];
    if (first) {
      const example = `“${first.text}” for ${names.of(first.rater)} rating ${names.of(first.ratee)} (${matrixCopy.skipReason[first.reason]})`;
      text += matrixCopy.pasteSkipped(plan.skipped.length, example);
    }
    if (plan.outside > 0) text += matrixCopy.pasteOutside(plan.outside);
    setMessage(text);
  }

  function onCopy(e: ClipboardEvent<HTMLDivElement>) {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', inputText(tieAt(active.r, active.c)));
  }

  const activeMember = members[active.r];
  const activeTarget = members[active.c];

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
        <div
          ref={(el) => {
            gridRef.current = el;
            place('--rows', n)(el);
            place('--cols', n)(el);
          }}
          role="grid"
          aria-label={matrixCopy.gridLabel(layer.label)}
          aria-describedby={helpId}
          aria-rowcount={n + 1}
          aria-colcount={n + 1}
          aria-activedescendant={editing ? undefined : cellId(active.r, active.c)}
          tabIndex={0}
          className="matrix__grid"
          onKeyDown={onGridKeyDown}
          onPaste={onPaste}
          onCopy={onCopy}
          onClick={(e) => {
            const cell = cellFromEvent(e);
            if (!cell) return;
            if (editing && !commit(null)) return;
            moveTo(cell.r, cell.c);
            gridRef.current?.focus();
          }}
          onDoubleClick={(e) => {
            const cell = cellFromEvent(e);
            if (!cell) return;
            setActive(cell);
            if (!isSelf(cell.r, cell.c))
              setEditing({ text: inputText(tieAt(cell.r, cell.c)), error: null });
          }}
        >
          <div role="row" aria-rowindex={1} className="matrix__header-row">
            <div role="columnheader" aria-colindex={1} className="matrix__corner">
              {matrixCopy.corner}
            </div>
            {colList.map((c) => (
              <div
                key={c}
                ref={place('--c', c)}
                role="columnheader"
                aria-colindex={c + 2}
                className={c === active.c ? 'matrix__col-header is-active' : 'matrix__col-header'}
                title={names.of(members[c]?.id ?? '')}
              >
                <span className="matrix__col-label">{names.of(members[c]?.id ?? '')}</span>
              </div>
            ))}
          </div>
          {rowList.map((r) => {
            const rater = members[r];
            if (!rater) return null;
            return (
              <div
                key={r}
                ref={place('--r', r)}
                role="row"
                aria-rowindex={r + 2}
                className="matrix__row"
              >
                <div
                  role="rowheader"
                  aria-colindex={1}
                  className={r === active.r ? 'matrix__row-header is-active' : 'matrix__row-header'}
                  title={names.of(rater.id)}
                >
                  {names.of(rater.id)}
                </div>
                {colList.map((c) => {
                  const ratee = members[c];
                  if (!ratee) return null;
                  const tie = tieAt(r, c);
                  const state = cellState(rater.id, ratee.id, tie);
                  const isActive = r === active.r && c === active.c;
                  return (
                    <Cell
                      key={c}
                      id={cellId(r, c)}
                      r={r}
                      c={c}
                      layer={layer}
                      tie={tie}
                      state={state}
                      active={isActive}
                      editor={
                        isActive && editing ? (
                          <input
                            ref={inputRef}
                            className="matrix__editor"
                            value={editing.text}
                            aria-label={matrixCopy.cellLabel(
                              names.of(rater.id),
                              names.of(ratee.id),
                              matrixCopy.editValue,
                            )}
                            aria-invalid={editing.error !== null}
                            onChange={(e) => {
                              setEditing({ text: e.currentTarget.value, error: null });
                            }}
                            onKeyDown={onEditorKeyDown}
                            onBlur={() => {
                              if (!commit(null)) setEditing(null);
                            }}
                          />
                        ) : null
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="matrix__status" role="status">
        {editing?.error ?? message}
      </p>
      <p className="matrix__position num" aria-hidden="true">
        {activeMember && activeTarget
          ? matrixCopy.position(names.of(activeMember.id), names.of(activeTarget.id))
          : ''}
      </p>
    </>
  );
}

interface CellProps {
  id: string;
  r: number;
  c: number;
  layer: LayerDefinition;
  tie: Tie | undefined;
  state: CellState;
  active: boolean;
  editor: ReactNode;
}

function Cell({ id, r, c, layer, tie, state, active, editor }: CellProps) {
  const value = tie?.value ?? null;
  const shade = value !== null && state === 'value' ? shadeClass(layer, value) : '';
  const classes = ['matrix__cell', `matrix__cell--${state}`, shade, active ? 'is-active' : '']
    .filter(Boolean)
    .join(' ');
  let content: ReactNode;
  if (editor) content = editor;
  else if (state === 'self') content = <span className="visually-hidden">{matrixCopy.self}</span>;
  else if (state === 'not-rated')
    content = <span className="visually-hidden">{matrixCopy.notRated}</span>;
  else if (state === 'declined')
    content = <span className="visually-hidden">{matrixCopy.declined}</span>;
  else if (state === 'not-applicable')
    content = (
      <>
        <span aria-hidden="true">{matrixCopy.naMark}</span>
        <span className="visually-hidden">{matrixCopy.notApplicable}</span>
      </>
    );
  else if (value !== null) content = formatRating(layer, value);
  return (
    <div
      ref={place('--c', c)}
      id={id}
      role="gridcell"
      aria-colindex={c + 2}
      aria-selected={active}
      aria-readonly={state === 'self' ? true : undefined}
      aria-disabled={state === 'self' ? true : undefined}
      data-cell=""
      data-r={r}
      data-c={c}
      className={classes}
    >
      {content}
    </div>
  );
}
