// Paints a Scene on a 2D canvas. Ties arrive grouped by colour, width, dash
// and opacity, so the drawing state changes a few dozen times per frame rather
// than once per tie.

import type { Scene } from './scene';

export function paint(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  scene: Scene,
  dpr: number,
): void {
  const { theme } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  if (scene.background) {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }

  ctx.lineCap = 'butt';
  for (const b of scene.lines) {
    ctx.globalAlpha = b.alpha;
    ctx.strokeStyle = b.stroke;
    ctx.lineWidth = b.width;
    ctx.setLineDash(b.dash);
    // One stroke per tie: in the benchmark, one path holding a whole batch
    // rasterised about twice as slowly (CLAUDE.md D50).
    const c = b.coords;
    for (let i = 0; i < c.length; i += 4) {
      ctx.beginPath();
      ctx.moveTo(c[i] as number, c[i + 1] as number);
      ctx.lineTo(c[i + 2] as number, c[i + 3] as number);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  for (const a of scene.arrows) {
    const path = new Path2D();
    const c = a.coords;
    for (let i = 0; i < c.length; i += 6) {
      path.moveTo(c[i] as number, c[i + 1] as number);
      path.lineTo(c[i + 2] as number, c[i + 3] as number);
      path.lineTo(c[i + 4] as number, c[i + 5] as number);
      path.closePath();
    }
    ctx.globalAlpha = a.alpha;
    ctx.fillStyle = a.fill;
    ctx.fill(path);
  }

  const dash = [theme.dash / 2, theme.dash / 2];
  for (const n of scene.nodes) {
    ctx.globalAlpha = n.alpha;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI);
    ctx.fillStyle = n.fill;
    ctx.fill();
    ctx.setLineDash(n.dashed ? dash : []);
    ctx.lineWidth = n.strokeWidth;
    ctx.strokeStyle = n.stroke;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Selection and focus: an ink ring outside a paper halo (design-system §2.3).
  ctx.globalAlpha = 1;
  for (const r of scene.rings) {
    ctx.lineWidth = theme.focusWidth;
    ctx.strokeStyle = theme.paper;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r + theme.line + theme.focusWidth / 2, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r + theme.line + (theme.focusWidth * 3) / 2, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // Subgroup members: a thin ink ring outside a paper halo.
  for (const r of scene.groupRings) {
    ctx.lineWidth = theme.focusWidth;
    ctx.strokeStyle = theme.paper;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r + theme.line + theme.focusWidth / 2, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = theme.line;
    ctx.strokeStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r + theme.line + theme.focusWidth, 0, 2 * Math.PI);
    ctx.stroke();
  }

  ctx.font = theme.labelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = theme.focusWidth * 2;
  for (const l of scene.labels) {
    ctx.globalAlpha = l.alpha;
    ctx.textAlign = l.align ?? 'center';
    ctx.strokeStyle = theme.paper;
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = theme.ink;
    ctx.fillText(l.text, l.x, l.y);
  }
  ctx.globalAlpha = 1;
  ctx.font = theme.groupFont;
  ctx.textAlign = 'center';
  for (const l of scene.groupLabels) {
    ctx.strokeStyle = theme.paper;
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = theme.graphite;
    ctx.fillText(l.text, l.x, l.y);
  }
}
