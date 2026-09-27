// Draws a map document on a 2D canvas: the PNG export. The page's fonts are
// the ones the document was measured with, so text lands where it was laid out.

import type { FontRole, MapDocument, Primitive } from './document';
import type { ExportTheme } from './theme';

/** The part of CanvasRenderingContext2D the painter uses (a test records it). */
export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'arc'
  | 'rect'
  | 'clip'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'fillText'
  | 'strokeText'
  | 'setLineDash'
> & {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

/** The CSS font shorthand for a role, from the type tokens. */
export function fontFor(theme: ExportTheme, role: FontRole, size: number): string {
  const px = `${String(size)}px`;
  switch (role) {
    case 'label':
      return `${theme.weights.medium} ${px} ${theme.fontCondensed}`;
    case 'group':
      return `${theme.weights.semibold} ${px} ${theme.fontSans}`;
    case 'medium':
      return `${theme.weights.medium} ${px} ${theme.fontSans}`;
    case 'regular':
      return `${theme.weights.regular} ${px} ${theme.fontSans}`;
  }
}

function draw(ctx: PaintContext, p: Primitive, theme: ExportTheme): void {
  switch (p.kind) {
    case 'lines': {
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      ctx.setLineDash(p.dash);
      const c = p.coords;
      for (let i = 0; i < c.length; i += 4) {
        ctx.beginPath();
        ctx.moveTo(c[i] as number, c[i + 1] as number);
        ctx.lineTo(c[i + 2] as number, c[i + 3] as number);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      return;
    }
    case 'polygon': {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.fill;
      ctx.beginPath();
      for (let i = 0; i < p.points.length; i += 2) {
        const x = p.points[i] as number;
        const y = p.points[i + 1] as number;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'polyline': {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width;
      ctx.beginPath();
      for (let i = 0; i < p.points.length; i += 2) {
        const x = p.points[i] as number;
        const y = p.points[i + 1] as number;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }
    case 'circle': {
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.setLineDash(p.dash);
        ctx.lineWidth = p.strokeWidth;
        ctx.strokeStyle = p.stroke;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    case 'rect':
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.fill;
      ctx.fillRect(p.x, p.y, p.width, p.height);
      return;
    case 'text':
      ctx.globalAlpha = p.alpha;
      ctx.font = fontFor(theme, p.role, p.size);
      ctx.textAlign = p.align;
      ctx.textBaseline = 'alphabetic';
      if (p.halo) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = p.halo.width;
        ctx.strokeStyle = p.halo.colour;
        ctx.strokeText(p.text, p.x, p.y);
      }
      ctx.fillStyle = p.fill;
      ctx.fillText(p.text, p.x, p.y);
      return;
  }
}

/** Paints the document at `scale` device pixels per CSS pixel. */
export function paintDocument(
  ctx: PaintContext,
  doc: MapDocument,
  theme: ExportTheme,
  scale: number,
): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const layer of doc.layers) {
    ctx.save();
    if (layer.clip) {
      ctx.beginPath();
      ctx.rect(layer.clip.x, layer.clip.y, layer.clip.width, layer.clip.height);
      ctx.clip();
    }
    for (const p of layer.items) draw(ctx, p, theme);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Device pixels per CSS pixel for a resolution choice. */
export function pngScale(
  resolution: 'x1' | 'x2' | 'print',
  doc: Pick<MapDocument, 'width'>,
  theme: ExportTheme,
): number {
  if (resolution === 'x1') return 1;
  if (resolution === 'x2') return 2;
  // Print: the picture spans the printable width of an A4 landscape page at the print resolution.
  const inches = theme.printWidth / 96;
  return (inches * theme.printDpi) / doc.width;
}

/** Renders the document to PNG bytes in the browser. */
export async function documentToPng(
  doc: MapDocument,
  theme: ExportTheme,
  scale: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(doc.width * scale));
  canvas.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw on a canvas.');
  paintDocument(ctx, doc, theme, scale);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the image.'));
    }, 'image/png');
  });
}
