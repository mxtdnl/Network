// Drives the map canvas: pan and zoom (d3-zoom), dragging to pin, hover,
// and frame scheduling. React owns the controls around the map; this class
// owns everything that changes at frame rate, so pointer movement never
// re-renders React.
//
// Interaction cache (CLAUDE.md D50). The full picture is drawn once into a
// bitmap. While the view is moving, frames reuse that bitmap under the new
// transform and draw only the highlighted members crisply on top; the full
// picture is redrawn once the view has been still for `--m-base`. A highlight
// draws the cached picture faded, then the highlighted members and ties at
// full strength, instead of redrawing all ties. Large maps draw the full
// picture in a worker (renderWorker.ts), so the redraw never blocks input;
// small ones, and browsers without OffscreenCanvas, draw it here.

import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { parseDuration } from '../durations';
import { paint } from './canvas';
import {
  parseEasing,
  settleJob as settleOnMainThread,
  type ForceLayout,
  type SettleJob,
} from './layout';
import type { MapModel } from './model';
import type { LayoutWorkerRequest, LayoutWorkerResponse } from './layoutWorker';
import type { RenderRequest, RenderResponse } from './renderWorker';
import {
  NO_HIGHLIGHT,
  buildScene,
  highlightSet,
  insidePolygon,
  type Highlight,
  type Point,
  type Transform,
} from './scene';
import type { MapTheme } from './theme';
import type { LayoutRequest } from './useMapModel';

export interface ControllerEvents {
  select: (index: number | null) => void;
  pinned: (count: number) => void;
  /** Shift-click: add the member to the subgroup, or take them out. */
  toggleGroup: (index: number) => void;
  /** A lasso was drawn round these members; `add` when Shift was held. */
  lasso: (indices: number[], add: boolean) => void;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const CLICK_SLOP = 4;
const ZOOM_STEP = 1.5;
const SCALE_EXTENT: [number, number] = [0.05, 12];
/** Below this many ties the full picture is drawn on the main thread: it takes a few milliseconds. */
const WORKER_MIN_TIES = 3000;
/**
 * From this many attractions a force or grouped layout after the first is
 * settled in a worker (D111): on the main thread 250 members and 5,000 pairs
 * took ~400 ms and stalled the page after every change of weights.
 */
const LAYOUT_WORKER_MIN_LINKS = 1500;

interface Base {
  image: HTMLCanvasElement | ImageBitmap;
  t: Transform;
  version: number;
}

const sameTransform = (a: Transform, b: Transform) => a.x === b.x && a.y === b.y && a.k === b.k;

function createLayoutWorker(): Worker | null {
  try {
    return new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

function createRenderWorker(): Worker | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    return new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export class MapController {
  private readonly ctx: CanvasRenderingContext2D;
  /** Main-thread drawing surface for the full picture. */
  private readonly offscreen = document.createElement('canvas');
  private readonly localCtx: CanvasRenderingContext2D;
  private worker: Worker | null = null;
  private layoutWorker: Worker | null = null;
  private layoutJob: { id: number; job: SettleJob } | null = null;
  private layoutId = 0;
  private base: Base | null = null;
  /** Incremented whenever the picture changes other than by pan and zoom. */
  private version = 0;
  private inFlight: { id: number; t: Transform; version: number } | null = null;
  private renderId = 0;
  private readonly zoomBehaviour: ZoomBehavior<HTMLCanvasElement, unknown>;
  private readonly selection: Selection<HTMLCanvasElement, unknown, null, undefined>;
  private model: MapModel | null = null;
  private transform: Transform = { x: 0, y: 0, k: 1 };
  private highlight: Highlight = { ...NO_HIGHLIGHT };
  private tool: 'pan' | 'lasso' = 'pan';
  private lassoPath: Point[] | null = null;
  private layoutKind = '';
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private idleTimer = 0;
  private fitted = false;
  /** The legend's corner (lower left), kept clear by fit to view: its right and top edges. */
  private reserved = { right: 0, top: Infinity, noteBottom: 0 };
  private drag: { index: number; x: number; y: number; moved: boolean; id: number } | null = null;
  private down: { x: number; y: number } | null = null;
  private readonly widths = new Map<string, number>();
  private readonly measure = (text: string): number => {
    let w = this.widths.get(text);
    if (w === undefined) {
      this.ctx.font = this.theme.labelFont;
      w = this.ctx.measureText(text).width;
      this.widths.set(text, w);
    }
    return w;
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private theme: MapTheme,
    private readonly idleMs: number,
    private readonly events: ControllerEvents,
    readonly layout: ForceLayout,
  ) {
    const ctx = canvas.getContext('2d');
    const localCtx = this.offscreen.getContext('2d');
    if (!ctx || !localCtx) throw new Error('This browser cannot draw on a canvas.');
    this.ctx = ctx;
    this.localCtx = localCtx;
    this.worker = createRenderWorker();
    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<RenderResponse>) => {
        this.received(event.data);
      };
      // If the worker cannot run, draw on the main thread instead.
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        this.inFlight = null;
        this.requestPaint();
      };
    }

    this.layoutWorker = createLayoutWorker();
    if (this.layoutWorker) {
      this.layoutWorker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
        this.settled(event.data);
      };
      // If the worker cannot run, settle layouts on the main thread instead.
      this.layoutWorker.onerror = () => {
        this.layoutWorker?.terminate();
        this.layoutWorker = null;
        const pending = this.layoutJob;
        this.layoutJob = null;
        if (pending && this.model) {
          this.layout.stop();
          this.settled({ id: pending.id, result: settleOnMainThread(pending.job) });
        }
      };
    }

    this.zoomBehaviour = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .filter((event: Event) => {
        if (event.type === 'wheel') return true;
        if ((event as MouseEvent).button) return false;
        // With the lasso, a drag draws round members instead of panning.
        if (this.tool === 'lasso') return false;
        // A press on a member drags it instead of panning.
        const p = this.eventPoint(event);
        return p === null || this.hit(p.x, p.y) === null;
      })
      .on('zoom', (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        const t = event.transform;
        this.transform = { x: t.x, y: t.y, k: t.k };
        this.moved();
      });
    this.selection = select(canvas);
    this.selection.call(this.zoomBehaviour).on('dblclick.zoom', null);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('dblclick', this.onDoubleClick);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.layoutWorker?.terminate();
    this.layoutWorker = null;
    this.layoutJob = null;
    if (this.base?.image instanceof ImageBitmap) this.base.image.close();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.idleTimer);
    this.layout.stop();
    this.selection.on('.zoom', null);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
  }

  setTheme(theme: MapTheme): void {
    this.theme = theme;
    this.invalidate();
  }

  /**
   * Shows a new model. When the layout changes (another layout, layer or
   * weights), members move from where they were drawn to their new positions
   * over `--m-layout`, or at once under reduced motion (plan Q16). A change of
   * layout kind also fits the new arrangement into view.
   */
  setModel(model: MapModel, request: LayoutRequest): void {
    this.model = model;
    const radii = model.nodes.map((n) => n.radius);
    const first = this.layout.nodes.length !== model.n || this.layoutKind === '';
    const before = first ? null : this.layout.positions.map((p) => ({ x: p.x, y: p.y }));
    // The first layout is settled here, so nothing moves on load (spec §12).
    const { changed, job } = this.layout.prepare(
      request.key,
      model.n,
      request.weights,
      radii,
      request.spec,
      first || !this.layoutWorker ? Infinity : LAYOUT_WORKER_MIN_LINKS,
    );
    if (job && this.layoutWorker) {
      const id = ++this.layoutId;
      this.layoutJob = { id, job };
      const message: LayoutWorkerRequest = { id, job };
      this.layoutWorker.postMessage(message);
    } else if (!job) {
      this.layoutJob = null;
    }
    this.laidOut(changed, before, request.spec.kind);
  }

  /** A worker's settled layout: members move to it from where they are drawn now. */
  private settled({ id, result }: LayoutWorkerResponse): void {
    const pending = this.layoutJob;
    if (!pending || pending.id !== id) return;
    this.layoutJob = null;
    const before = this.layout.positions.map((p) => ({ x: p.x, y: p.y }));
    const changed = this.layout.accept(pending.job, result);
    this.laidOut(changed, before, pending.job.spec.kind);
  }

  private laidOut(
    changed: boolean,
    before: { x: number; y: number }[] | null,
    kind: LayoutRequest['spec']['kind'],
  ): void {
    const kindChanged = this.layoutKind !== '' && this.layoutKind !== kind;
    this.layoutKind = kind;
    if (changed && before && this.fitted) {
      const style = getComputedStyle(document.documentElement);
      const duration = reducedMotion() ? 0 : parseDuration(style.getPropertyValue('--m-layout'));
      this.layout.animateFrom(
        before,
        duration,
        parseEasing(style.getPropertyValue('--ease-layout')),
        performance.now(),
      );
    }
    // Positions restored from a saved view are fitted, so the view looks as it was saved.
    const restored = this.layout.takeRestored();
    if ((!this.fitted || kindChanged || restored) && this.width > 0) {
      this.fit();
      this.fitted = true;
    }
    this.invalidate();
  }

  setHighlight(patch: Partial<Highlight>): void {
    const next = { ...this.highlight, ...patch };
    if (
      next.hovered === this.highlight.hovered &&
      next.focused === this.highlight.focused &&
      next.selected === this.highlight.selected &&
      next.group === this.highlight.group &&
      next.path === this.highlight.path
    )
      return;
    const persistent = next.group !== this.highlight.group || next.path !== this.highlight.path;
    this.highlight = next;
    // The subgroup and the path are part of the full picture (rings), so it is redrawn.
    if (persistent) this.invalidate();
    else this.requestPaint();
  }

  setTool(tool: 'pan' | 'lasso'): void {
    this.tool = tool;
    this.lassoPath = null;
    this.canvas.classList.toggle('map__canvas--lasso', tool === 'lasso');
    this.requestPaint();
  }

  resize(width: number, height: number, dpr: number): void {
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const c of [this.canvas, this.offscreen]) {
      c.width = Math.max(1, Math.round(width * dpr));
      c.height = Math.max(1, Math.round(height * dpr));
    }
    if (!this.fitted && this.model) {
      this.fit();
      this.fitted = true;
    }
    this.invalidate();
  }

  get positions(): readonly Point[] {
    return this.layout.positions;
  }

  /** The view on screen, for the map export: the zoom transform and the canvas size in CSS pixels. */
  viewport(): { transform: Transform; width: number; height: number } {
    return { transform: { ...this.transform }, width: this.width, height: this.height };
  }

  screenOf(index: number): Point | null {
    const p = this.layout.positions[index];
    if (!p) return null;
    return {
      x: p.x * this.transform.k + this.transform.x,
      y: p.y * this.transform.k + this.transform.y,
    };
  }

  /** The legend's right and top edges, and the bottom of the coverage note (0 when none). */
  setReserved(right: number, top: number, noteBottom = 0): void {
    this.reserved = { right, top, noteBottom };
  }

  /** The free area beside or above the legend, whichever lets the members appear larger. */
  private freeArea(bw: number, bh: number): { x: number; y: number; w: number; h: number } {
    const { right, top, noteBottom: y } = this.reserved;
    const beside = { x: right, y, w: this.width - right, h: this.height - y };
    const above = { x: 0, y, w: this.width, h: Math.min(top, this.height) - y };
    const scale = (a: { w: number; h: number }) => Math.min(a.w / bw, a.h / bh);
    return scale(beside) >= scale(above) ? beside : above;
  }

  /** Fits the visible members into the view. */
  fit(): void {
    const model = this.model;
    if (!model || this.width === 0) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const node of model.nodes) {
      if (!node.visible) continue;
      const p = this.layout.settled[node.index];
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (!Number.isFinite(x0)) return;
    const pad = this.theme.nodeMax * 2 + this.theme.labelSize * 2;
    // Labels on the circle point outwards, so the circle needs room for names beside it.
    const padX = this.layoutKind === 'circular' ? pad + this.theme.labelSize * 6 : pad;
    const bw = Math.max(x1 - x0, 1);
    const bh = Math.max(y1 - y0, 1);
    const area = this.freeArea(bw, bh);
    const k = Math.min(
      SCALE_EXTENT[1],
      Math.max(SCALE_EXTENT[0], Math.min((area.w - 2 * padX) / bw, (area.h - 2 * pad) / bh)),
    );
    const t = zoomIdentity
      .translate(
        area.x + area.w / 2 - (k * (x0 + x1)) / 2,
        area.y + area.h / 2 - (k * (y0 + y1)) / 2,
      )
      .scale(k);
    this.zoomBehaviour.transform(this.selection, t);
  }

  zoomBy(direction: 1 | -1): void {
    this.zoomBehaviour.scaleBy(this.selection, direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  /** Pans so the member is in view and clear of `avoid` (the legend), in screen pixels. */
  reveal(index: number, avoid: DOMRect | null, origin: DOMRect | null): void {
    const p = this.screenOf(index);
    if (!p) return;
    const r = (this.model?.nodes[index]?.radius ?? 0) + this.theme.focusWidth * 2;
    const inView = p.x - r >= 0 && p.y - r >= 0 && p.x + r <= this.width && p.y + r <= this.height;
    let covered = false;
    if (avoid && origin) {
      const ax = avoid.left - origin.left;
      const ay = avoid.top - origin.top;
      covered =
        p.x + r > ax && p.x - r < ax + avoid.width && p.y + r > ay && p.y - r < ay + avoid.height;
    }
    if (inView && !covered) return;
    const area = this.freeArea(1, 1);
    this.zoomBehaviour.translateBy(
      this.selection,
      (area.x + area.w / 2 - p.x) / this.transform.k,
      (area.y + area.h / 2 - p.y) / this.transform.k,
    );
  }

  unpinAll(): void {
    this.layout.unpinAll();
    this.events.pinned(0);
  }

  // ------------------------------------------------------------ painting

  private invalidate(): void {
    this.version += 1;
    this.requestPaint();
  }

  private moved(): void {
    this.lastMove = performance.now();
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.requestPaint();
    }, this.idleMs);
    this.requestPaint();
  }

  requestPaint(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paintFrame();
    });
  }

  private fullScene(t: Transform, model = this.model as MapModel) {
    // The subgroup and the path are drawn into the full picture; hover and focus are not.
    const base: Highlight = {
      ...NO_HIGHLIGHT,
      group: this.highlight.group ?? null,
      path: this.highlight.path ?? null,
    };
    const size = { width: this.width, height: this.height };
    return buildScene(
      model,
      this.layout.positions,
      t,
      size,
      this.theme,
      base,
      'all',
      this.measure,
      this.layout.annotation,
    );
  }

  /** Brings the full picture up to date: now on the main thread, or by asking the worker. */
  private refreshBase(): void {
    const model = this.model;
    if (!model) return;
    const t = { ...this.transform };
    const large = model.edges.length >= WORKER_MIN_TIES;
    if (this.layout.animating) {
      // Every frame of a transition is drawn here. On large maps members move
      // without their ties, which are drawn again once they arrive.
      paint(this.localCtx, this.fullScene(t, large ? { ...model, edges: [] } : model), this.dpr);
      if (this.base?.image instanceof ImageBitmap) this.base.image.close();
      this.base = { image: this.offscreen, t, version: this.version };
      return;
    }
    const worker = large ? this.worker : null;
    // The first picture is drawn here too, so the map never starts blank.
    if (!worker || !this.base) {
      paint(this.localCtx, this.fullScene(t), this.dpr);
      if (this.base?.image instanceof ImageBitmap) this.base.image.close();
      this.base = { image: this.offscreen, t, version: this.version };
      return;
    }
    if (this.inFlight) return;
    const id = ++this.renderId;
    this.inFlight = { id, t, version: this.version };
    worker.postMessage({ id, scene: this.fullScene(t), dpr: this.dpr } satisfies RenderRequest);
  }

  private received({ id, bitmap }: RenderResponse): void {
    const req = this.inFlight;
    if (!req || req.id !== id) {
      bitmap.close();
      return;
    }
    this.inFlight = null;
    // The picture was drawn at the size requested; one from before a resize is dropped.
    if (bitmap.width !== this.canvas.width || bitmap.height !== this.canvas.height) {
      bitmap.close();
    } else {
      if (this.base?.image instanceof ImageBitmap) this.base.image.close();
      this.base = { image: bitmap, t: req.t, version: req.version };
    }
    this.requestPaint();
  }

  private paintFrame(): void {
    const model = this.model;
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.paper;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!model || this.width === 0) return;

    const t = this.transform;
    if (this.layout.animating) {
      this.layout.advance(performance.now());
      this.version += 1;
      // One more frame after the last, at the settled positions.
      this.requestPaint();
    }
    // Exposed for tests and assistive tooling: whether members are moving or about to.
    const moving = this.layout.animating || this.layoutJob ? 'running' : 'idle';
    if (this.canvas.dataset.transition !== moving) this.canvas.dataset.transition = moving;
    const base = this.base;
    const idle = this.idleSince() >= this.idleMs;
    const outdated = !base || base.version !== this.version;
    const moved = !base || !sameTransform(base.t, t);
    if (outdated || (moved && idle)) this.refreshBase();
    // While the worker draws, the last picture is shown under the new transform.
    const current = this.base;
    if (!current) return;
    const bt = current.t;
    const k = t.k / bt.k;
    const lit = highlightSet(model, this.highlight);
    ctx.setTransform(k, 0, 0, k, dpr * (t.x - bt.x * k), dpr * (t.y - bt.y * k));
    ctx.globalAlpha = lit ? this.theme.fade : 1;
    ctx.drawImage(current.image, 0, 0);
    ctx.globalAlpha = 1;
    if (lit) {
      paint(
        ctx,
        buildScene(
          model,
          this.layout.positions,
          t,
          { width: this.width, height: this.height },
          this.theme,
          this.highlight,
          'lit',
          this.measure,
          this.layout.annotation,
        ),
        dpr,
      );
    }
    if (this.lassoPath && this.lassoPath.length > 1) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.lineWidth = this.theme.line;
      ctx.strokeStyle = this.theme.ink;
      ctx.setLineDash([this.theme.dash, this.theme.gap]);
      ctx.beginPath();
      this.lassoPath.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private lastMove = 0;
  private idleSince(): number {
    return performance.now() - this.lastMove;
  }

  // ------------------------------------------------------------ pointer

  private eventPoint(event: Event): Point | null {
    const e = event as MouseEvent & TouchEvent;
    const source = 'touches' in e && e.touches.length > 0 ? e.touches[0] : e;
    if (!source || typeof source.clientX !== 'number') return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  private hit(x: number, y: number): number | null {
    const model = this.model;
    if (!model) return null;
    const slop = this.theme.nodeMin + this.theme.line * 2;
    let best: number | null = null;
    let bestD = Infinity;
    for (const node of model.nodes) {
      if (!node.visible) continue;
      const p = this.screenOf(node.index);
      if (!p) continue;
      const r = Math.max(node.radius, slop);
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = node.index;
      }
    }
    return best;
  }

  private local(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // A press skips a running transition to the settled positions.
    if (this.layout.animating) {
      this.layout.finish();
      this.invalidate();
    }
    const p = this.local(e);
    if (this.tool === 'lasso') {
      this.lassoPath = [p];
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const index = this.hit(p.x, p.y);
    if (index === null) {
      this.down = p;
      return;
    }
    this.drag = { index, x: p.x, y: p.y, moved: false, id: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.lassoPath) {
      const last = this.lassoPath[this.lassoPath.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= CLICK_SLOP) {
        this.lassoPath.push(p);
        this.requestPaint();
      }
      return;
    }
    if (this.drag && e.pointerId === this.drag.id) {
      if (!this.drag.moved && Math.hypot(p.x - this.drag.x, p.y - this.drag.y) < CLICK_SLOP) return;
      if (!this.drag.moved) {
        this.drag.moved = true;
        this.layout.reheat(() => {
          this.lastMove = performance.now();
          this.invalidate();
        });
      }
      const t = this.transform;
      this.layout.pin(this.drag.index, (p.x - t.x) / t.k, (p.y - t.y) / t.k);
      this.lastMove = performance.now();
      this.invalidate();
      return;
    }
    if (e.buttons !== 0) {
      this.lastMove = performance.now();
      return;
    }
    const index = this.hit(p.x, p.y);
    this.canvas.classList.toggle('map__canvas--member', index !== null);
    this.setHighlight({ hovered: index });
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.lassoPath) {
      const path = this.lassoPath;
      this.lassoPath = null;
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      this.requestPaint();
      if (e.type !== 'pointerup' || !this.model) return;
      if (path.length < 3) {
        // A click with the lasso toggles the member under it.
        const index = this.hit(p.x, p.y);
        if (index !== null) this.events.toggleGroup(index);
        return;
      }
      const inside = this.model.nodes
        .filter((node) => {
          const q = node.visible ? this.screenOf(node.index) : null;
          return q !== null && insidePolygon(q, path);
        })
        .map((node) => node.index);
      this.events.lasso(inside, e.shiftKey);
      return;
    }
    if (this.drag && e.pointerId === this.drag.id) {
      const { index, moved } = this.drag;
      this.drag = null;
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      if (moved) {
        this.layout.cool();
        this.events.pinned(this.layout.pinned);
      } else if (e.type === 'pointerup') {
        if (e.shiftKey) this.events.toggleGroup(index);
        else this.events.select(index);
      }
      return;
    }
    if (this.down && e.type === 'pointerup') {
      if (Math.hypot(p.x - this.down.x, p.y - this.down.y) < CLICK_SLOP) this.events.select(null);
    }
    this.down = null;
  };

  private readonly onPointerLeave = () => {
    if (this.drag) return;
    this.canvas.classList.remove('map__canvas--member');
    this.setHighlight({ hovered: null });
  };

  // Double-clicking a pinned member releases it.
  private readonly onDoubleClick = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const index = this.hit(e.clientX - rect.left, e.clientY - rect.top);
    if (index === null) return;
    const node = this.layout.nodes[index];
    if (!node) return;
    node.fx = null;
    node.fy = null;
    this.events.pinned(this.layout.pinned);
    this.layout.reheat(() => {
      this.invalidate();
    });
    this.layout.cool();
  };
}
