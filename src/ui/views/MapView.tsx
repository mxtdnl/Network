import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Icon } from '../components/Icon';
import { durationToken } from '../durations';
import { percent } from '../copy/data';
import { formatValue, mapCopy } from '../copy/map';
import { metricCopy } from '../copy/metrics';
import { MapController } from '../map/controller';
import { registerMapFocus } from '../map/focus';
import { registerMapViewport } from '../map/viewport';
import { layerName } from '../map/legend';
import { nextMember, type MapModel } from '../map/model';
import { sharedLayout, useMapData, type MapData } from '../map/useMapModel';
import type { MapTheme } from '../map/theme';
import { useAppStore } from '../state/store';
import { clearPath, endSimulation } from '../state/tools';
import { EmptyState } from './EmptyState';
import { MapLegend } from './MapLegend';

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function groupLabel(model: MapModel, index: number): string {
  const g = model.fill.groups[model.nodes[index]?.group ?? -1];
  if (!g) return '';
  if (g.kind === 'value') return g.label;
  if (g.kind === 'community') return mapCopy.legend.community(Number(g.label));
  if (g.kind === 'other') return mapCopy.legend.other(model.fill.otherGroups);
  if (g.kind === 'notRecorded') return mapCopy.legend.notRecorded;
  return mapCopy.legend.noCommunity;
}

// The network map (spec §8): canvas drawing, a focusable button per member for
// keyboard and screen-reader use, the persistent legend, zoom controls and a
// visually hidden table of the same content.
export function MapView() {
  const project = useAppStore((s) => s.data.project);
  const results = useAppStore((s) => s.results);
  const data = useMapData();
  if (!project || project.members.length === 0) return <EmptyState />;
  if (!data) {
    return (
      <p className="map__message" role="status">
        {results.status === 'error' ? mapCopy.failed(results.error ?? '') : mapCopy.calculating}
      </p>
    );
  }
  return <MapCanvas data={data} />;
}

/** Legend extras for the map on screen: layout, subgroup, path and highlight marks. */
export function legendExtras(
  data: MapData,
  group: number,
  path: boolean,
): NonNullable<Parameters<typeof MapLegend>[0]['extras']> {
  return {
    layout: data.settings.layout,
    groupBy:
      data.project.attribute_definitions.find((a) => a.key === data.settings.groupBy)?.label ?? '',
    group,
    path,
    highlight: data.mapModel.highlighted?.size ?? 0,
  };
}

interface MapCanvasProps {
  data: MapData;
  /**
   * Presentation mode (spec §8): the map only, drawn with the presentation
   * theme (larger labels). No controls, notes, legend or focusable members;
   * the presentation shows the legend beside the map and handles the keys.
   */
  presentation?: { theme: MapTheme };
}

export function MapCanvas({ data, presentation }: MapCanvasProps) {
  const { mapModel: model, result, settings, layout } = data;
  const theme = presentation?.theme ?? data.theme;
  const analyst = !presentation;
  const selected = useAppStore((s) => s.selection.member);
  const group = useAppStore((s) => s.selection.group);
  const path = useAppStore((s) => s.tools.path);
  const simulation = useAppStore((s) => s.tools.resilience);
  const removal = useAppStore((s) => s.tools.removal);
  const showRemoval = useAppStore((s) => s.tools.showRemoval);
  const setTools = useAppStore((s) => s.setTools);
  const selectMember = useAppStore((s) => s.selectMember);
  const setGroup = useAppStore((s) => s.setGroup);
  const toggleGroupMember = useAppStore((s) => s.toggleGroupMember);
  const setMap = useAppStore((s) => s.setMap);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const running = useAppStore((s) => s.results.status === 'running');
  const coverage = result.coverage;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const legendRef = useRef<HTMLElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MapController | null>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const [focused, setFocused] = useState<number | null>(null);
  const [pinned, setPinned] = useState(0);
  const instructionsId = useId();
  const tableId = useId();

  const indexOf = useMemo(() => new Map(model.nodes.map((n) => [n.id, n.index])), [model]);
  const selectedIndex = selected === null ? null : (indexOf.get(selected) ?? null);

  const open = useCallback(
    (index: number | null) => {
      const id = index === null ? null : (model.nodes[index]?.id ?? null);
      selectMember(id);
      if (id !== null) setRightPanel('member');
    },
    [model, selectMember, setRightPanel],
  );
  const toggle = useCallback(
    (index: number) => {
      const id = model.nodes[index]?.id;
      if (id !== undefined) toggleGroupMember(id);
    },
    [model, toggleGroupMember],
  );
  const lasso = useCallback(
    (indices: number[], add: boolean) => {
      const ids = indices.map((i) => model.nodes[i]?.id).filter((x): x is string => !!x);
      const current = useAppStore.getState().selection.group;
      setGroup(add ? [...current, ...ids] : ids);
      if (ids.length > 0) setRightPanel('explore');
    },
    [model, setGroup, setRightPanel],
  );
  const openRef = useRef({ open, toggle, lasso });
  useEffect(() => {
    openRef.current = { open, toggle, lasso };
  }, [open, toggle, lasso]);

  // Controller lifetime: one per mounted canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const idle = durationToken('--m-base');
    const controller = new MapController(
      canvas,
      theme,
      idle,
      {
        select: (i) => {
          openRef.current.open(i);
        },
        pinned: setPinned,
        toggleGroup: (i) => {
          openRef.current.toggle(i);
        },
        lasso: (indices, add) => {
          openRef.current.lasso(indices, add);
        },
      },
      sharedLayout,
    );
    controller.setTool(useAppStore.getState().map.tool);
    controllerRef.current = controller;
    if (analyst) registerMapViewport(() => controller.viewport());
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      // Fit to view keeps members clear of the legend.
      const legend = legendRef.current?.getBoundingClientRect();
      // …and below the notes and the selection tools along the top edge.
      const top = [noteRef.current, toolsRef.current].reduce((m, el) => {
        const r = el?.getBoundingClientRect();
        return r && r.height > 0 ? Math.max(m, r.bottom - rect.top) : m;
      }, 0);
      if (legend) controller.setReserved(legend.right - rect.left, legend.top - rect.top, top);
      controller.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    });
    observer.observe(container);
    if (legendRef.current) observer.observe(legendRef.current);
    if (noteRef.current) observer.observe(noteRef.current);
    return () => {
      observer.disconnect();
      if (analyst) registerMapViewport(null);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [theme, analyst]);

  useEffect(() => {
    controllerRef.current?.setModel(model, layout);
  }, [model, layout]);

  const groupSet = useMemo(() => {
    const s = new Set<number>();
    for (const id of group) {
      const i = indexOf.get(id);
      if (i !== undefined) s.add(i);
    }
    return s;
  }, [group, indexOf]);
  const inGroup = useMemo(() => new Set(group), [group]);
  const pathIndices = useMemo(() => {
    const members = path?.status === 'ready' ? path.result?.members : undefined;
    if (!members) return null;
    return members.map((id) => indexOf.get(id)).filter((i): i is number => i !== undefined);
  }, [path, indexOf]);
  useEffect(() => {
    controllerRef.current?.setHighlight({
      selected: selectedIndex,
      group: groupSet,
      path: pathIndices,
    });
  }, [selectedIndex, groupSet, pathIndices]);
  useEffect(() => {
    controllerRef.current?.setTool(settings.tool);
  }, [settings.tool]);

  const focusMember = useCallback((index: number) => {
    const el = buttons.current.get(index);
    if (!el) return false;
    el.focus();
    return true;
  }, []);
  useEffect(() => {
    registerMapFocus((id) => {
      const i = indexOf.get(id);
      return i === undefined ? false : focusMember(i);
    });
    return () => {
      registerMapFocus(null);
    };
  }, [indexOf, focusMember]);

  const visible = useMemo(
    () =>
      model.nodes.filter((n) => n.visible).sort((a, b) => a.name.localeCompare(b.name, 'en-GB')),
    [model],
  );
  // Roving tab stop: the focused member, else the selected one, else the first.
  const tabStop =
    focused !== null && model.nodes[focused]?.visible
      ? focused
      : selectedIndex !== null && model.nodes[selectedIndex]?.visible
        ? selectedIndex
        : (visible[0]?.index ?? null);

  const onFocus = (index: number) => {
    setFocused(index);
    const c = controllerRef.current;
    if (!c) return;
    c.setHighlight({ focused: index });
    c.reveal(
      index,
      legendRef.current?.getBoundingClientRect() ?? null,
      containerRef.current?.getBoundingClientRect() ?? null,
    );
  };
  const onBlur = () => {
    setFocused(null);
    controllerRef.current?.setHighlight({ focused: null });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const c = controllerRef.current;
    if (!c) return;
    const dir = ARROWS[event.key];
    if (dir) {
      event.preventDefault();
      const next = nextMember(model, c.positions, index, dir);
      if (next !== null) focusMember(next);
      return;
    }
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (event.shiftKey) toggle(index);
        else open(index);
        return;
      case 'Escape':
        if (selected !== null) {
          event.preventDefault();
          open(null);
        }
        return;
      case '+':
      case '=':
        event.preventDefault();
        c.zoomBy(1);
        return;
      case '-':
        event.preventDefault();
        c.zoomBy(-1);
        return;
      case '0':
        event.preventDefault();
        c.fit();
        return;
    }
  };

  const neighbourNames = (i: number) =>
    (model.neighbours[i] ?? [])
      .map((j) => model.nodes[j]?.name ?? '')
      .sort((a, b) => a.localeCompare(b, 'en-GB'))
      .join(', ');

  const name = layerName(model);
  const visibleCount = visible.length;

  return (
    <div className={analyst ? 'map' : 'map map--presentation'}>
      <div ref={containerRef} className="map__stage">
        <canvas ref={canvasRef} className="map__canvas" aria-hidden="true" />
      </div>

      {analyst && (
        <div ref={noteRef} className="map__notes">
          {coverage?.belowThreshold && (
            <p className="map__coverage" role="note">
              <Icon name="warning" />
              {mapCopy.coverage(percent(coverage.rate), percent(coverage.threshold))}
            </p>
          )}
          {model.ego && (
            <p className="map__mode">
              <span>{mapCopy.modes.ego(model.ego.name, model.ego.depth)}</span>
              <button
                type="button"
                className="button button--text"
                onClick={() => {
                  setMap({ ego: null });
                }}
              >
                {mapCopy.modes.exitEgo}
              </button>
            </p>
          )}
          {path && path.status !== 'running' && (
            <p className="map__mode">
              <span>
                {path.status === 'ready' && path.result
                  ? mapCopy.modes.path(
                      model.nodes[indexOf.get(path.from) ?? -1]?.name ?? '',
                      model.nodes[indexOf.get(path.to) ?? -1]?.name ?? '',
                    )
                  : mapCopy.modes.noPath}
              </span>
              <button type="button" className="button button--text" onClick={clearPath}>
                {mapCopy.modes.clearPath}
              </button>
            </p>
          )}
          {simulation && (
            <p className="map__mode">
              <span>
                {showRemoval
                  ? mapCopy.modes.removed(removal.length)
                  : mapCopy.modes.removedShown(removal.length)}
              </span>
              <button
                type="button"
                className="button button--text"
                onClick={() => {
                  setTools({ showRemoval: !showRemoval });
                }}
              >
                {showRemoval ? mapCopy.modes.showRemoved : mapCopy.modes.hideRemoved}
              </button>
              <button type="button" className="button button--text" onClick={endSimulation}>
                {mapCopy.modes.endSimulation}
              </button>
            </p>
          )}
          {(visibleCount === 0 || model.edges.length === 0 || running) && (
            <p className="map__notice" role="status">
              {running
                ? mapCopy.calculating
                : visibleCount === 0
                  ? mapCopy.noMembers
                  : mapCopy.noTies}
            </p>
          )}
        </div>
      )}

      {analyst && (
        <div ref={toolsRef} className="map__tools" role="group" aria-label={mapCopy.tools.group}>
          <button
            type="button"
            className="map__tool"
            aria-pressed={settings.tool === 'lasso'}
            onClick={() => {
              setMap({ tool: settings.tool === 'lasso' ? 'pan' : 'lasso' });
            }}
          >
            {mapCopy.tools.lasso}
          </button>
          {group.length > 0 && (
            <button
              type="button"
              className="map__tool"
              onClick={() => {
                setGroup([]);
              }}
            >
              {mapCopy.tools.clearGroup(group.length)}
            </button>
          )}
        </div>
      )}

      {analyst && (
        <>
          <p id={instructionsId} className="visually-hidden">
            {mapCopy.nodes.instructions}
          </p>
          <div
            role="group"
            aria-label={mapCopy.nodes.group}
            aria-describedby={instructionsId}
            className="map__nodes"
          >
            {visible.map((node) => (
              <button
                key={node.id}
                ref={(el) => {
                  if (el) buttons.current.set(node.index, el);
                  else buttons.current.delete(node.index);
                }}
                type="button"
                className="map__node"
                tabIndex={node.index === tabStop ? 0 : -1}
                aria-pressed={node.index === selectedIndex}
                onFocus={() => {
                  onFocus(node.index);
                }}
                onBlur={onBlur}
                onKeyDown={(e) => {
                  onKeyDown(e, node.index);
                }}
                onClick={() => {
                  open(node.index);
                }}
              >
                {mapCopy.nodes.label(
                  node.name,
                  groupLabel(model, node.index),
                  model.neighbours[node.index]?.length ?? 0,
                )}
                {inGroup.has(node.id) ? mapCopy.nodes.inGroup : ''}
              </button>
            ))}
          </div>
        </>
      )}

      {analyst && (
        <MapLegend
          ref={legendRef}
          model={model}
          theme={theme}
          extras={legendExtras(data, groupSet.size, pathIndices !== null && pathIndices.length > 1)}
        />
      )}

      {analyst && (
        <div className="map__zoom" role="group" aria-label={mapCopy.zoom.group}>
          {pinned > 0 && (
            <button
              type="button"
              className="button button--text map__unpin"
              onClick={() => {
                controllerRef.current?.unpinAll();
              }}
            >
              {mapCopy.zoom.unpin}
            </button>
          )}
          <div className="map__zoom-buttons">
            <button
              type="button"
              className="map__zoom-button"
              aria-label={mapCopy.zoom.in}
              title={mapCopy.zoom.in}
              onClick={() => controllerRef.current?.zoomBy(1)}
            >
              <Icon name="plus" />
            </button>
            <button
              type="button"
              className="map__zoom-button"
              aria-label={mapCopy.zoom.out}
              title={mapCopy.zoom.out}
              onClick={() => controllerRef.current?.zoomBy(-1)}
            >
              <Icon name="minus" />
            </button>
            <button
              type="button"
              className="map__zoom-button"
              aria-label={mapCopy.zoom.fit}
              title={mapCopy.zoom.fit}
              onClick={() => controllerRef.current?.fit()}
            >
              <Icon name="fit" />
            </button>
          </div>
        </div>
      )}

      <table className="visually-hidden" aria-labelledby={tableId}>
        <caption id={tableId}>{mapCopy.table.caption(name)}</caption>
        <thead>
          <tr>
            <th scope="col">{mapCopy.table.member}</th>
            <th scope="col">{mapCopy.table.group}</th>
            <th scope="col">
              {mapCopy.table.size}: {metricCopy[model.size.metric].label}
            </th>
            <th scope="col">{mapCopy.table.ties}</th>
            <th scope="col">{mapCopy.table.connected}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((node) => (
            <tr key={node.id}>
              <th scope="row">{node.name}</th>
              <td>{groupLabel(model, node.index)}</td>
              <td>{formatValue(node.sizeValue)}</td>
              <td>{model.neighbours[node.index]?.length ?? 0}</td>
              <td>{neighbourNames(node.index)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
