import { useEffect, useMemo, useRef, useState } from 'react';
import { paint } from '../map/canvas';
import type { MapModel } from '../map/model';
import { NO_HIGHLIGHT, buildScene, hitTest, type Point, type Transform } from '../map/scene';
import { sharedLayout, type MapData } from '../map/useMapModel';
import { useAppStore } from '../state/store';

/** Fits the visible members' positions into a box, keeping clear of its edges. */
function fitTransform(
  model: MapModel,
  positions: readonly Point[],
  width: number,
  height: number,
  padX: number,
  padY: number,
): Transform {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const node of model.nodes) {
    const p = positions[node.index];
    if (!node.visible || !p) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return { x: width / 2, y: height / 2, k: 1 };
  const k = Math.min(
    (width - 2 * padX) / Math.max(x1 - x0, 1),
    (height - 2 * padY) / Math.max(y1 - y0, 1),
  );
  return { x: width / 2 - (k * (x0 + x1)) / 2, y: height / 2 - (k * (y0 + y1)) / 2, k };
}

// A small, static copy of the map for side-by-side comparison (spec §8):
// members sit where the map puts them (the shared layout), so two layers can
// be compared position for position. Pointer only; the tables beside it are
// the keyboard and screen-reader route. Selection, hover and the subgroup
// are the shared ones.
export function MiniMap({ data, model, label }: { data: MapData; model: MapModel; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const selected = useAppStore((s) => s.selection.member);
  const hovered = useAppStore((s) => s.selection.hovered);
  const group = useAppStore((s) => s.selection.group);
  const selectMember = useAppStore((s) => s.selectMember);
  const setHovered = useAppStore((s) => s.setHovered);
  const toggleGroupMember = useAppStore((s) => s.toggleGroupMember);
  const setRightPanel = useAppStore((s) => s.setRightPanel);
  const { theme, layout } = data;

  // The same layout as the map, computed here if the map has not been shown.
  const positions = useMemo(() => {
    sharedLayout.update(
      layout.key,
      data.model.n,
      layout.weights,
      data.model.nodes.map((n) => n.radius),
      layout.spec,
    );
    return sharedLayout.settled.map((p) => ({ x: p.x, y: p.y }));
  }, [layout, data.model]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => {
      const r = box.getBoundingClientRect();
      setSize({ width: r.width, height: r.height, dpr: window.devicePixelRatio || 1 });
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, []);

  const index = useMemo(() => new Map(model.nodes.map((n) => [n.id, n.index])), [model]);
  const t = useMemo(
    () =>
      fitTransform(
        model,
        positions,
        size.width,
        size.height,
        // Names are centred under their members: room for about ten characters either side.
        theme.nodeMax + theme.labelSize * 5,
        theme.nodeMax + theme.labelSize,
      ),
    [model, positions, size, theme],
  );
  const scene = useMemo(() => {
    const groupSet = new Set(
      group.map((id) => index.get(id)).filter((i): i is number => i !== undefined),
    );
    return buildScene(model, positions, t, size, theme, {
      ...NO_HIGHLIGHT,
      hovered: hovered === null ? null : (index.get(hovered) ?? null),
      selected: selected === null ? null : (index.get(selected) ?? null),
      group: groupSet,
    });
  }, [model, positions, t, size, theme, hovered, selected, group, index]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    canvas.width = Math.max(1, Math.round(size.width * size.dpr));
    canvas.height = Math.max(1, Math.round(size.height * size.dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) paint(ctx, scene, size.dpr);
  }, [scene, size]);

  const hit = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return hitTest(scene, e.clientX - r.left, e.clientY - r.top, theme.nodeMin + theme.line * 2);
  };

  return (
    <figure className="minimap">
      <div ref={boxRef} className="minimap__stage">
        <canvas
          ref={canvasRef}
          className="minimap__canvas"
          aria-hidden="true"
          onPointerMove={(e) => {
            const i = hit(e);
            e.currentTarget.classList.toggle('map__canvas--member', i !== null);
            setHovered(i === null ? null : (model.nodes[i]?.id ?? null));
          }}
          onPointerLeave={() => {
            setHovered(null);
          }}
          onPointerUp={(e) => {
            const i = hit(e);
            const id = i === null ? null : (model.nodes[i]?.id ?? null);
            if (id !== null && e.shiftKey) {
              toggleGroupMember(id);
              return;
            }
            selectMember(id);
            if (id !== null) setRightPanel('member');
          }}
        />
      </div>
      <figcaption className="minimap__caption">{label}</figcaption>
    </figure>
  );
}
