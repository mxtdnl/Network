// Serialises a map document as a self-contained SVG: every mark is a vector
// element, and the Fira files the text uses are embedded as WOFF2 data URIs in
// an @font-face rule, so the drawing looks the same wherever it is opened and
// its text stays selectable and searchable (CLAUDE.md D107). Nothing is
// fetched when the file is opened.

import type { FontRole, MapDocument, Primitive } from './document';
import { documentText } from './document';
import {
  LATIN_EXT_RANGE_CSS,
  LATIN_RANGE_CSS,
  ROLE_FACE,
  fontFile,
  needsLatinExt,
  toBase64,
  type Face,
  type FontLoader,
} from './fonts';
import type { ExportTheme } from './theme';

const n = (v: number) => String(Math.round(v * 100) / 100);

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The faces a document's text uses. */
export function facesUsed(doc: MapDocument): Face[] {
  const roles = new Set<FontRole>();
  for (const l of doc.layers) for (const p of l.items) if (p.kind === 'text') roles.add(p.role);
  return [...new Set([...roles].map((r) => ROLE_FACE[r]))].sort();
}

/** @font-face rules embedding the files a document needs. */
export async function fontFaceCss(doc: MapDocument, load: FontLoader): Promise<string> {
  const ext = needsLatinExt(documentText(doc));
  const rules: string[] = [];
  for (const face of facesUsed(doc)) {
    const [family, weight] = face.split('-') as [string, string];
    const name = family === 'sans' ? 'Fira Sans' : 'Fira Sans Condensed';
    const subsets = ext ? (['latin-ext', 'latin'] as const) : (['latin'] as const);
    for (const subset of subsets) {
      const bytes = await load(fontFile(face, subset, 'woff2'));
      rules.push(
        `@font-face{font-family:'${name}';font-style:normal;font-weight:${weight};` +
          `src:url(data:font/woff2;base64,${toBase64(bytes)}) format('woff2');` +
          `unicode-range:${subset === 'latin' ? LATIN_RANGE_CSS : LATIN_EXT_RANGE_CSS};}`,
      );
    }
  }
  // Tabular figures for every number (spec §12).
  rules.push(`text{font-feature-settings:'tnum' 1;font-variant-numeric:tabular-nums;}`);
  return rules.join('\n');
}

function fontAttrs(theme: ExportTheme, role: FontRole, size: number): string {
  const family = role === 'label' ? theme.fontCondensed : theme.fontSans;
  const weight =
    role === 'label' || role === 'medium'
      ? theme.weights.medium
      : role === 'group'
        ? theme.weights.semibold
        : theme.weights.regular;
  return `font-family="${escapeXml(family)}" font-weight="${weight}" font-size="${n(size)}"`;
}

const ANCHOR = { left: 'start', center: 'middle', right: 'end' } as const;

function element(p: Primitive, theme: ExportTheme): string {
  const opacity = (a: number) => (a < 1 ? ` opacity="${n(a)}"` : '');
  switch (p.kind) {
    case 'lines': {
      const stroke = `stroke="${p.stroke}" stroke-width="${n(p.width)}"${opacity(p.alpha)}`;
      const c = p.coords;
      if (p.dash.length === 0) {
        let d = '';
        for (let i = 0; i < c.length; i += 4) {
          d += `M${n(c[i] as number)} ${n(c[i + 1] as number)}L${n(c[i + 2] as number)} ${n(c[i + 3] as number)}`;
        }
        return `<path d="${d}" fill="none" ${stroke}/>`;
      }
      // Dashed ties are separate lines, so each starts its dash pattern afresh as on the canvas.
      let lines = '';
      for (let i = 0; i < c.length; i += 4) {
        lines += `<line x1="${n(c[i] as number)}" y1="${n(c[i + 1] as number)}" x2="${n(c[i + 2] as number)}" y2="${n(c[i + 3] as number)}"/>`;
      }
      return `<g fill="none" ${stroke} stroke-dasharray="${p.dash.map(n).join(' ')}">${lines}</g>`;
    }
    case 'polygon':
      return `<polygon points="${p.points.map(n).join(' ')}" fill="${p.fill}"${opacity(p.alpha)}/>`;
    case 'polyline':
      return `<polyline points="${p.points.map(n).join(' ')}" fill="none" stroke="${p.stroke}" stroke-width="${n(p.width)}"/>`;
    case 'circle': {
      const fill = p.fill ? `fill="${p.fill}"` : 'fill="none"';
      const stroke = p.stroke
        ? ` stroke="${p.stroke}" stroke-width="${n(p.strokeWidth)}"${p.dash.length > 0 ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : ''}`
        : '';
      return `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" ${fill}${stroke}${opacity(p.alpha)}/>`;
    }
    case 'rect':
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.width)}" height="${n(p.height)}" fill="${p.fill}"/>`;
    case 'text': {
      const halo = p.halo
        ? ` stroke="${p.halo.colour}" stroke-width="${n(p.halo.width)}" stroke-linejoin="round" paint-order="stroke"`
        : '';
      return `<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="${ANCHOR[p.align]}" ${fontAttrs(theme, p.role, p.size)} fill="${p.fill}"${halo}${opacity(p.alpha)}>${escapeXml(p.text)}</text>`;
    }
  }
}

/** The document as SVG text. `description` becomes the accessible description. */
export async function documentToSvg(
  doc: MapDocument,
  theme: ExportTheme,
  load: FontLoader,
  description: string,
): Promise<string> {
  const css = await fontFaceCss(doc, load);
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(doc.width)}" height="${n(doc.height)}" viewBox="0 0 ${n(doc.width)} ${n(doc.height)}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${escapeXml(doc.title)}</title>`,
    `<desc id="desc">${escapeXml(description)}</desc>`,
    `<style>${css}</style>`,
    `<rect width="100%" height="100%" fill="${doc.background}"/>`,
  ];
  doc.layers.forEach((layer, k) => {
    if (layer.clip) {
      const c = layer.clip;
      parts.push(
        `<clipPath id="clip-${String(k)}"><rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.width)}" height="${n(c.height)}"/></clipPath>`,
        `<g clip-path="url(#clip-${String(k)})">`,
      );
    } else parts.push('<g>');
    for (const p of layer.items) parts.push(element(p, theme));
    parts.push('</g>');
  });
  parts.push('</svg>');
  return parts.join('\n');
}
