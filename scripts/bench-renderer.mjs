/* global window */
// Map renderer benchmark (CLAUDE.md D50): SVG against canvas at 250 nodes and
// 10,000 directed edges, the size spec §8 requires to stay interactive.
//
//   node scripts/bench-renderer.mjs
//
// Each renderer draws the same random scene (seeded) with every encoding the
// map uses: variable edge width, seven edge colours, dashed edges, arrowheads,
// node fill and outline. It then runs 240 frames of continuous pan and zoom
// and 60 hover-highlight changes, and reports the time between animation
// frames (what the user sees) and the scripting time per frame. Colours here
// are arbitrary benchmark values, not design tokens; nothing in this file is
// shipped.

import { chromium } from '@playwright/test';

const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const WIDTH = 760;
const HEIGHT = 800;

function page(kind, dpr) {
  return `<!doctype html><html><body style="margin:0">
<div id="root" style="width:${WIDTH}px;height:${HEIGHT}px"></div>
<script>
const N = 250, E = 10000, W = ${WIDTH}, H = ${HEIGHT}, DPR = ${dpr};
let s = 20260926;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const nodes = Array.from({ length: N }, () => ({ x: rnd() * W, y: rnd() * H, r: 4 + rnd() * 12, c: Math.floor(rnd() * 8) }));
const seen = new Set(); const edges = [];
while (edges.length < E) { const a = Math.floor(rnd() * N), b = Math.floor(rnd() * N);
  if (a === b || seen.has(a * N + b)) continue; seen.add(a * N + b);
  edges.push({ a, b, w: 0.5 + rnd() * 3, v: Math.floor(rnd() * 7), dash: rnd() < 0.3 }); }
const pal = ['#44aa99','#332288','#999933','#117733','#ddcc77','#cc6677','#88ccee','#882255'];
const val = ['#833110','#9d5524','#a67b55','#919191','#5188a1','#156d8e','#004d6e'];
let hovered = -1;
const root = document.getElementById('root');
let render;
if ('${kind}' === 'svg') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const style = document.createElementNS(NS, 'style');
  style.textContent = 'line{vector-effect:non-scaling-stroke}.fade{opacity:.3}' +
    val.map((c, i) => '.v' + i + '{stroke:' + c + '}').join('');
  svg.appendChild(style);
  const defs = document.createElementNS(NS, 'defs');
  val.forEach((c, i) => { const m = document.createElementNS(NS, 'marker'); m.id = 'm' + i;
    m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '10'); m.setAttribute('refY', '5');
    m.setAttribute('markerWidth', '6'); m.setAttribute('markerHeight', '6'); m.setAttribute('orient', 'auto');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M0,0L10,5L0,10z'); p.setAttribute('fill', c);
    m.appendChild(p); defs.appendChild(m); });
  svg.appendChild(defs);
  const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
  const lines = edges.map((e) => { const l = document.createElementNS(NS, 'line');
    const A = nodes[e.a], B = nodes[e.b];
    l.setAttribute('x1', A.x); l.setAttribute('y1', A.y); l.setAttribute('x2', B.x); l.setAttribute('y2', B.y);
    l.setAttribute('stroke-width', e.w); l.setAttribute('class', 'v' + e.v);
    if (e.dash) l.setAttribute('stroke-dasharray', '4 3');
    l.setAttribute('marker-end', 'url(#m' + e.v + ')'); g.appendChild(l); return l; });
  const circles = nodes.map((n) => { const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', n.r);
    c.setAttribute('fill', pal[n.c]); c.setAttribute('stroke', '#1c2127'); c.setAttribute('vector-effect', 'non-scaling-stroke');
    g.appendChild(c); return c; });
  root.appendChild(svg);
  let lastHover = -2;
  render = (t) => {
    g.setAttribute('transform', 'translate(' + t.x + ',' + t.y + ') scale(' + t.k + ')');
    if (hovered !== lastHover) { lastHover = hovered;
      edges.forEach((e, i) => lines[i].classList.toggle('fade', hovered >= 0 && e.a !== hovered && e.b !== hovered)); }
  };
} else {
  const cv = document.createElement('canvas'); cv.width = W * DPR; cv.height = H * DPR;
  cv.style.width = W + 'px'; cv.style.height = H + 'px'; root.appendChild(cv);
  const ctx = cv.getContext('2d');
  const naive = '${kind}' !== 'batched';
  const arrow = (path, e, k) => {
    const A = nodes[e.a], B = nodes[e.b];
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, h = 6 / k;
    const tx = B.x - ux * B.r, ty = B.y - uy * B.r;
    path.moveTo(tx, ty); path.lineTo(tx - ux * h - uy * h * 0.5, ty - uy * h + ux * h * 0.5);
    path.lineTo(tx - ux * h + uy * h * 0.5, ty - uy * h - ux * h * 0.5); path.closePath();
  };
  const draw = (target, t) => {
    const c = target;
    c.setTransform(DPR, 0, 0, DPR, 0, 0); c.fillStyle = '#fbfcfc'; c.fillRect(0, 0, W, H);
    c.setTransform(DPR * t.k, 0, 0, DPR * t.k, DPR * t.x, DPR * t.y);
    for (let pass = 0; pass < 2; pass++) {
      c.globalAlpha = pass === 0 && hovered >= 0 ? 0.3 : 1;
      for (let v = 0; v < 7; v++) for (const dash of [false, true]) {
        c.strokeStyle = val[v]; c.fillStyle = val[v]; c.setLineDash(dash ? [4 / t.k, 3 / t.k] : []);
        // Batched: one path per quantised width, one fill for all arrowheads.
        const byWidth = new Map(); const heads = new Path2D();
        for (const e of edges) {
          if (e.v !== v || e.dash !== dash) continue;
          const lit = hovered < 0 || e.a === hovered || e.b === hovered;
          if (pass === 0 ? hovered >= 0 && lit : hovered < 0 || !lit) continue;
          const A = nodes[e.a], B = nodes[e.b];
          if (naive) {
            c.lineWidth = e.w / t.k; c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
            const h = new Path2D(); arrow(h, e, t.k); c.fill(h);
          } else {
            const q = Math.round(e.w * 2) / 2;
            let path = byWidth.get(q); if (!path) { path = new Path2D(); byWidth.set(q, path); }
            path.moveTo(A.x, A.y); path.lineTo(B.x, B.y); arrow(heads, e, t.k);
          }
        }
        if (!naive) { for (const [q, path] of byWidth) { c.lineWidth = q / t.k; c.stroke(path); } c.fill(heads); }
      }
    }
    c.globalAlpha = 1; c.setLineDash([]); c.lineWidth = 1 / t.k; c.strokeStyle = '#1c2127';
    for (const n of nodes) { c.fillStyle = pal[n.c]; c.beginPath(); c.arc(n.x, n.y, n.r, 0, 2 * Math.PI); c.fill(); c.stroke(); }
  };
  // Cached: while the view moves, the last full frame is redrawn as a bitmap
  // under the new transform; hover and anything else redraws in full.
  const cached = '${kind}' === 'cached';
  const snap = document.createElement('canvas'); snap.width = cv.width; snap.height = cv.height;
  const sctx = snap.getContext('2d'); let snapT = null; let lastHover = -2;
  render = (t) => {
    if (cached && snapT && hovered !== lastHover) {
      // Highlight: the cached frame faded, then only the member's own ties on top.
      lastHover = hovered;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fbfcfc'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.globalAlpha = hovered >= 0 ? 0.3 : 1; ctx.drawImage(snap, 0, 0); ctx.globalAlpha = 1;
      if (hovered >= 0) {
        ctx.setTransform(DPR * t.k, 0, 0, DPR * t.k, DPR * t.x, DPR * t.y);
        for (const e of edges) {
          if (e.a !== hovered && e.b !== hovered) continue;
          const A = nodes[e.a], B = nodes[e.b];
          ctx.strokeStyle = val[e.v]; ctx.fillStyle = val[e.v]; ctx.lineWidth = e.w / t.k;
          ctx.setLineDash(e.dash ? [4 / t.k, 3 / t.k] : []);
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
          const h = new Path2D(); arrow(h, e, t.k); ctx.fill(h);
        }
        ctx.setLineDash([]); ctx.lineWidth = 1 / t.k; ctx.strokeStyle = '#1c2127';
        for (const n of nodes) { ctx.fillStyle = pal[n.c]; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
      }
      return;
    }
    if (cached && snapT) {
      const k = t.k / snapT.k;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fbfcfc'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(k, 0, 0, k, DPR * (t.x - snapT.x * k), DPR * (t.y - snapT.y * k));
      ctx.drawImage(snap, 0, 0);
      return;
    }
    lastHover = hovered;
    if (cached) { draw(sctx, t); snapT = t; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(snap, 0, 0); }
    else draw(ctx, t);
  };
}
window.bench = async (frames, mode) => {
  const deltas = [], script = [];
  let last = performance.now();
  for (let f = 0; f < frames; f++) {
    await new Promise((resolve) => requestAnimationFrame((now) => {
      deltas.push(now - last); last = now;
      const t0 = performance.now();
      if (mode === 'hover') hovered = f % 2 === 0 ? f % N : -1;
      const k = mode === 'hover' ? 1 : 1 + 0.8 * Math.sin(f / 20);
      render({ x: mode === 'hover' ? 0 : 40 * Math.cos(f / 15), y: mode === 'hover' ? 0 : 30 * Math.sin(f / 15), k });
      script.push(performance.now() - t0); resolve();
    }));
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { deltas: deltas.slice(2), script: script.slice(2) };
};
render({ x: 0, y: 0, k: 1 });
</script></body></html>`;
}

const stats = (xs) => {
  const a = [...xs].sort((p, q) => p - q);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return {
    mean: a.reduce((s, x) => s + x, 0) / a.length,
    p50: q(0.5),
    p95: q(0.95),
    max: a[a.length - 1],
  };
};
const fmt = (s) =>
  `mean ${s.mean.toFixed(1)} ms, median ${s.p50.toFixed(1)}, p95 ${s.p95.toFixed(1)}, max ${s.max.toFixed(1)}`;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
console.log(`Chromium ${browser.version()}, 250 nodes, 10,000 edges, ${WIDTH}×${HEIGHT} px`);
for (const [kind, dpr] of [
  ['svg', 1],
  ['canvas', 1],
  ['batched', 1],
  ['cached', 1],
  ['cached', 2],
]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage();
  await p.setContent(page(kind, dpr));
  await p.evaluate(() => window.bench(20, 'pan'));
  for (const mode of ['pan', 'hover']) {
    const r = await p.evaluate((m) => window.bench(m === 'pan' ? 240 : 60, m), mode);
    const label = `${kind}${kind === 'svg' ? '' : ` canvas, DPR ${String(dpr)}`} ${mode === 'pan' ? 'pan and zoom' : 'hover highlight'}`;
    console.log(
      `${label}\n  frame interval: ${fmt(stats(r.deltas))}\n  script per frame: ${fmt(stats(r.script))}`,
    );
  }
  await context.close();
}
await browser.close();
