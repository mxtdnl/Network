// The PDF report, generated in the browser with pdf-lib (CLAUDE.md D106). The
// report's content comes from export/report.ts and its map from
// export/document.ts, drawn as vectors with the same primitives as the SVG and
// PNG. Sizes come from the print tokens (export/theme.ts, D108); text is set
// in subsets of the self-hosted Fira fonts with tabular figures. This module
// is loaded only when a report is exported.

import fontkit from '@pdf-lib/fontkit';
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  TextRenderingMode,
  appendBezierCurve,
  beginText,
  clip,
  closePath,
  concatTransformationMatrix,
  endPath,
  endText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb as pdfRgb,
  setDashPattern,
  setFillingColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  stroke,
  type PDFFont,
  type PDFName,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import { APP_VERSION } from '../../data/schema';
import { reportCopy } from '../copy/export';
import type { FontRole, MapDocument, Primitive } from './document';
import { ROLE_FACE, fontFile, woffToSfnt, type Face, type FontLoader, type Inflate } from './fonts';
import type { Block, ReportModel } from './report';
import type { ExportTheme, PrintTheme } from './theme';

/** PDF points per CSS pixel (72 pt and 96 px to the inch). */
const PT = 0.75;
/** Control-point distance for a circle drawn as four Bézier curves. */
const KAPPA = 0.5522847498;

// Characters the Fira Latin files may lack, written out rather than dropped.
const FALLBACK: Record<string, string> = {
  '≥': '>=',
  '≤': '<=',
  '≠': 'not equal to',
  γ: 'gamma',
  Σ: 'sum',
  '→': 'to',
  '↔': 'both ways',
  '⁺': '+',
  '⁻': '−',
};

interface FaceFonts {
  latin: { pdf: PDFFont; has: (cp: number) => boolean };
  ext: { pdf: PDFFont; has: (cp: number) => boolean };
}

type Fonts = Record<Face, FaceFonts>;
type Weight = 'regular' | 'medium' | 'semibold';
const WEIGHT_FACE: Record<Weight, Face> = {
  regular: 'sans-400',
  medium: 'sans-500',
  semibold: 'sans-600',
};

interface Run {
  font: PDFFont;
  text: string;
}

/** Splits text into runs by the font file that has each character. */
function runs(fonts: FaceFonts, text: string): Run[] {
  const out: Run[] = [];
  const push = (font: PDFFont, s: string) => {
    const last = out[out.length - 1];
    if (last?.font === font) last.text += s;
    else out.push({ font, text: s });
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (fonts.latin.has(cp)) push(fonts.latin.pdf, ch);
    else if (fonts.ext.has(cp)) push(fonts.ext.pdf, ch);
    else {
      const alt = FALLBACK[ch] ?? '?';
      for (const c of alt) push(fonts.latin.pdf, c);
    }
  }
  return out;
}

function colour(hex: string) {
  const v = hex.replace('#', '');
  const n = Number.parseInt(v.length === 3 ? v.replace(/./g, (c) => c + c) : v, 16);
  return pdfRgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Every text drawn in the PDF, with the fonts' fallbacks applied (for tests). */
export interface PdfOutput {
  bytes: Uint8Array;
  pages: number;
  /** Characters the fonts lacked and that were written out or replaced. */
  substituted: string[];
}

export interface PdfInput {
  report: ReportModel;
  map: MapDocument;
  exportTheme: ExportTheme;
  print: PrintTheme;
  loadFont: FontLoader;
  inflate: Inflate;
  now: Date;
}

class Writer {
  private readonly alphaStates = new Map<string, Map<string, PDFName>>();
  readonly substituted = new Set<string>();
  page!: PDFPage;
  pageHeight = 0;
  pageWidth = 0;
  /** Top of the next block, in CSS px from the top of the page. */
  y = 0;
  readonly bodyPages: PDFPage[] = [];

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly print: PrintTheme,
  ) {}

  addPage(landscape = false, body = true): void {
    const w = landscape ? this.print.pageHeight : this.print.pageWidth;
    const h = landscape ? this.print.pageWidth : this.print.pageHeight;
    this.page = this.doc.addPage([w * PT, h * PT]);
    this.pageWidth = w;
    this.pageHeight = h;
    this.y = this.print.margin;
    if (body) this.bodyPages.push(this.page);
  }

  get contentWidth(): number {
    return this.pageWidth - this.print.margin * 2;
  }

  /** Bottom of the text area: the footer sits below it. */
  get bottom(): number {
    return this.pageHeight - this.print.margin;
  }

  ops(...operators: PDFOperator[]): void {
    this.page.pushOperators(...operators);
  }

  alpha(a: number): PDFOperator[] {
    if (a >= 1) return [];
    const key = String(Math.round(a * 1000) / 1000);
    const pageKey = this.page.ref.toString();
    let states = this.alphaStates.get(pageKey);
    if (!states) {
      states = new Map();
      this.alphaStates.set(pageKey, states);
    }
    let name = states.get(key);
    if (name === undefined) {
      const dict = this.doc.context.obj({ Type: 'ExtGState', ca: a, CA: a });
      name = this.page.node.newExtGState('GS', dict);
      states.set(key, name);
    }
    return [setGraphicsState(name)];
  }

  faceFor(weight: Weight | FontRole): FaceFonts {
    const face =
      weight === 'regular' || weight === 'medium' || weight === 'semibold'
        ? WEIGHT_FACE[weight]
        : ROLE_FACE[weight];
    return this.fonts[face];
  }

  width(text: string, weight: Weight | FontRole, size: number): number {
    let w = 0;
    for (const r of runs(this.faceFor(weight), text)) w += r.font.widthOfTextAtSize(r.text, size);
    return w;
  }

  /**
   * Text operators at (x, baseline) in the current coordinate system. `flip`
   * is set inside the map, whose coordinates run downwards.
   */
  textOps(
    text: string,
    weight: Weight | FontRole,
    size: number,
    x: number,
    baseline: number,
    flip: boolean,
  ): PDFOperator[] {
    const out: PDFOperator[] = [beginText()];
    let cx = x;
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      const f = this.faceFor(weight);
      if (!f.latin.has(cp) && !f.ext.has(cp)) this.substituted.add(ch);
    }
    for (const r of runs(this.faceFor(weight), text)) {
      const key = this.page.node.newFontDictionary(r.font.name, r.font.ref);
      out.push(
        setFontAndSize(key, size),
        flip ? setTextMatrix(1, 0, 0, -1, cx, baseline) : setTextMatrix(1, 0, 0, 1, cx, baseline),
        showText(r.font.encodeText(r.text)),
      );
      cx += r.font.widthOfTextAtSize(r.text, size);
    }
    out.push(endText());
    return out;
  }

  /** Text in page coordinates (CSS px from the top left). */
  text(
    text: string,
    x: number,
    baseline: number,
    weight: Weight,
    size: number,
    fillHex: string,
    align: 'left' | 'right' = 'left',
  ): void {
    const w = this.width(text, weight, size);
    const left = align === 'right' ? x - w : x;
    this.ops(
      pushGraphicsState(),
      setFillingColor(colour(fillHex)),
      ...this.textOps(text, weight, size * PT, left * PT, (this.pageHeight - baseline) * PT, false),
      popGraphicsState(),
    );
  }

  rect(x: number, y: number, w: number, h: number, fillHex: string): void {
    this.ops(
      pushGraphicsState(),
      setFillingColor(colour(fillHex)),
      rectangle(x * PT, (this.pageHeight - y - h) * PT, w * PT, h * PT),
      fill(),
      popGraphicsState(),
    );
  }

  hline(x: number, y: number, w: number, strokeHex: string, width: number): void {
    this.ops(
      pushGraphicsState(),
      setStrokingColor(colour(strokeHex)),
      setLineWidth(width * PT),
      moveTo(x * PT, (this.pageHeight - y) * PT),
      lineTo((x + w) * PT, (this.pageHeight - y) * PT),
      stroke(),
      popGraphicsState(),
    );
  }

  wrap(text: string, width: number, weight: Weight, size: number, firstIndent = 0): string[] {
    const words = text.split(/\s+/).filter((w) => w !== '');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`;
      const room = width - (lines.length === 0 ? firstIndent : 0);
      if (line !== '' && this.width(next, weight, size) > room) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    return lines;
  }
}

// ------------------------------------------------------------------- the map

function mapOps(w: Writer, p: Primitive): PDFOperator[] {
  const circle = (x: number, y: number, r: number) => {
    const k = r * KAPPA;
    return [
      moveTo(x + r, y),
      appendBezierCurve(x + r, y + k, x + k, y + r, x, y + r),
      appendBezierCurve(x - k, y + r, x - r, y + k, x - r, y),
      appendBezierCurve(x - r, y - k, x - k, y - r, x, y - r),
      appendBezierCurve(x + k, y - r, x + r, y - k, x + r, y),
      closePath(),
    ];
  };
  const wrapState = (inner: PDFOperator[], a = 1) => [
    pushGraphicsState(),
    ...w.alpha(a),
    ...inner,
    popGraphicsState(),
  ];
  switch (p.kind) {
    case 'lines': {
      const out: PDFOperator[] = [
        setStrokingColor(colour(p.stroke)),
        setLineWidth(p.width),
        setLineCap(LineCapStyle.Butt),
        setDashPattern(p.dash, 0),
      ];
      const c = p.coords;
      // One subpath per tie: each starts its dash pattern afresh, as on the canvas.
      for (let i = 0; i < c.length; i += 4) {
        out.push(
          moveTo(c[i] as number, c[i + 1] as number),
          lineTo(c[i + 2] as number, c[i + 3] as number),
          stroke(),
        );
      }
      return wrapState(out, p.alpha);
    }
    case 'polygon': {
      const out: PDFOperator[] = [setFillingColor(colour(p.fill))];
      for (let i = 0; i < p.points.length; i += 2) {
        const x = p.points[i] as number;
        const y = p.points[i + 1] as number;
        out.push(i === 0 ? moveTo(x, y) : lineTo(x, y));
      }
      out.push(closePath(), fill());
      return wrapState(out, p.alpha);
    }
    case 'polyline': {
      const out: PDFOperator[] = [setStrokingColor(colour(p.stroke)), setLineWidth(p.width)];
      for (let i = 0; i < p.points.length; i += 2) {
        const x = p.points[i] as number;
        const y = p.points[i + 1] as number;
        out.push(i === 0 ? moveTo(x, y) : lineTo(x, y));
      }
      out.push(stroke());
      return wrapState(out);
    }
    case 'circle': {
      const out: PDFOperator[] = [];
      if (p.fill) out.push(setFillingColor(colour(p.fill)), ...circle(p.x, p.y, p.r), fill());
      if (p.stroke) {
        out.push(
          setStrokingColor(colour(p.stroke)),
          setLineWidth(p.strokeWidth),
          setDashPattern(p.dash, 0),
          ...circle(p.x, p.y, p.r),
          stroke(),
        );
      }
      return wrapState(out, p.alpha);
    }
    case 'rect':
      return wrapState([
        setFillingColor(colour(p.fill)),
        rectangle(p.x, p.y, p.width, p.height),
        fill(),
      ]);
    case 'text': {
      const size = p.size;
      const width = w.width(p.text, p.role, size);
      const x = p.align === 'center' ? p.x - width / 2 : p.align === 'right' ? p.x - width : p.x;
      const out: PDFOperator[] = [];
      if (p.halo) {
        out.push(
          setStrokingColor(colour(p.halo.colour)),
          setLineWidth(p.halo.width),
          setLineJoin(LineJoinStyle.Round),
          setTextRenderingMode(TextRenderingMode.Outline),
          ...w.textOps(p.text, p.role, size, x, p.y, true),
        );
      }
      out.push(
        setFillingColor(colour(p.fill)),
        setTextRenderingMode(TextRenderingMode.Fill),
        ...w.textOps(p.text, p.role, size, x, p.y, true),
      );
      return wrapState(out, p.alpha);
    }
  }
}

/** Draws the map document into the box (CSS px on the page), scaled to fit. */
function drawMap(
  w: Writer,
  doc: MapDocument,
  box: { x: number; y: number; width: number; height: number },
) {
  const s = Math.min(1, box.width / doc.width, box.height / doc.height);
  const ox = box.x;
  const oy = box.y;
  // Document coordinates run down from the top left; the page's run up from the bottom left.
  const matrix = concatTransformationMatrix(
    s * PT,
    0,
    0,
    -s * PT,
    ox * PT,
    (w.pageHeight - oy) * PT,
  );
  const out: PDFOperator[] = [pushGraphicsState(), matrix];
  for (const layer of doc.layers) {
    out.push(pushGraphicsState());
    if (layer.clip) {
      const c = layer.clip;
      out.push(rectangle(c.x, c.y, c.width, c.height), clip(), endPath());
    }
    for (const p of layer.items) out.push(...mapOps(w, p));
    out.push(popGraphicsState());
  }
  out.push(popGraphicsState());
  w.ops(...out);
  return doc.height * s;
}

// ------------------------------------------------------------------ blocks

function paragraph(w: Writer, b: Extract<Block, { kind: 'paragraph' }>, indent = 0) {
  const P = w.print;
  const style = b.small ? P.small : P.body;
  const tone = b.tone === 'graphite' ? P.colours.graphite : P.colours.ink;
  const measure = Math.min(P.measure, w.contentWidth) - indent;
  const leadText = b.lead ? `${b.lead} ` : '';
  const leadWidth = b.lead ? w.width(leadText, 'medium', style.size) : 0;
  const lines = w.wrap(b.text, measure, 'regular', style.size, leadWidth);
  for (let k = 0; k < lines.length; k++) {
    if (w.y + style.line > w.bottom) w.addPage();
    const baseline = w.y + (style.line + style.size * 0.7) / 2;
    const x = w.print.margin + indent;
    if (k === 0 && b.lead) {
      w.text(b.lead, x, baseline, 'medium', style.size, P.colours.ink);
      w.text(lines[k] ?? '', x + leadWidth, baseline, 'regular', style.size, tone);
    } else w.text(lines[k] ?? '', x, baseline, 'regular', style.size, tone);
    w.y += style.line;
  }
  w.y += P.space[1] ?? 0;
}

function warning(w: Writer, text: string) {
  const P = w.print;
  const icon = P.body.size;
  const x = P.margin;
  const top = w.y + (P.body.line - icon) / 2;
  if (w.y + P.body.line > w.bottom) w.addPage();
  // The warning glyph of the interface (Icon "warning"): an outlined triangle with a bar.
  const h = w.pageHeight;
  w.ops(
    pushGraphicsState(),
    setStrokingColor(colour(P.colours.ink)),
    setLineWidth(P.line * PT * 1.5),
    setLineJoin(LineJoinStyle.Round),
    moveTo((x + icon / 2) * PT, (h - top) * PT),
    lineTo((x + icon) * PT, (h - top - icon) * PT),
    lineTo(x * PT, (h - top - icon) * PT),
    closePath(),
    stroke(),
    moveTo((x + icon / 2) * PT, (h - top - icon * 0.35) * PT),
    lineTo((x + icon / 2) * PT, (h - top - icon * 0.65) * PT),
    stroke(),
    popGraphicsState(),
  );
  paragraph(w, { kind: 'paragraph', text }, icon + (P.space[1] ?? 0));
}

function heading(w: Writer, text: string) {
  const P = w.print;
  const style = P.subheading;
  // Keep a heading with at least three lines of what follows.
  const need = (P.space[3] ?? 0) + style.line + P.body.line * 3;
  if (w.y + need > w.bottom) w.addPage();
  else w.y += P.space[3] ?? 0;
  const lines = w.wrap(text, w.contentWidth, 'medium', style.size);
  for (const line of lines) {
    w.text(
      line,
      P.margin,
      w.y + (style.line + style.size * 0.7) / 2,
      'medium',
      style.size,
      P.colours.ink,
    );
    w.y += style.line;
  }
  w.y += P.space[0] ?? 0;
}

function table(w: Writer, b: Extract<Block, { kind: 'table' }>) {
  const P = w.print;
  const S = P.small;
  const gap = P.columnGap;
  const total = w.contentWidth;
  // Numeric columns take the width of their widest value or header word; the first column the rest.
  const widths = b.columns.map((c, k) => {
    if (k === 0) return 0;
    const values = b.rows.map((r) => w.width(r[k] ?? '', 'regular', S.size));
    const words = c.label.split(/\s+/).map((x) => w.width(x, 'medium', S.size));
    return Math.max(...values, ...words, 0);
  });
  const others = widths.reduce((s, x) => s + x, 0) + gap * (b.columns.length - 1);
  // Too many columns for the page: the table continues below with the first column repeated.
  const minFirst = total * 0.3;
  if (total - others < minFirst && b.columns.length > 2) {
    let used = 0;
    let k = 1;
    while (k < b.columns.length && used + (widths[k] ?? 0) + gap <= total - minFirst) {
      used += (widths[k] ?? 0) + gap;
      k += 1;
    }
    const cut = Math.max(2, k);
    const part = (from: number, to: number): Extract<Block, { kind: 'table' }> => ({
      kind: 'table',
      columns: [b.columns[0] ?? { label: '', numeric: false }, ...b.columns.slice(from, to)],
      rows: b.rows.map((r) => [r[0] ?? '', ...r.slice(from, to)]),
    });
    table(w, part(1, cut));
    table(w, part(cut, b.columns.length));
    return;
  }
  // Header labels of numeric columns may wrap; widen them a little if there is room.
  const first = Math.max(total - others, minFirst);
  widths[0] = first;
  const slack = total - widths.reduce((s, x) => s + x, 0) - gap * (b.columns.length - 1);
  if (slack > 0 && b.columns.length > 1) {
    const extra = slack / (b.columns.length - 1);
    for (let k = 1; k < widths.length; k++) widths[k] = (widths[k] ?? 0) + extra;
  }
  const xs: number[] = [];
  let x = P.margin;
  for (const width of widths) {
    xs.push(x);
    x += width + gap;
  }
  const cellLines = (text: string, k: number, weight: Weight) =>
    w.wrap(text, widths[k] ?? 0, weight, S.size);

  const header = () => {
    const lines = b.columns.map((c, k) => cellLines(c.label, k, 'medium'));
    const height = Math.max(...lines.map((l) => l.length)) * S.line;
    if (w.y + height + S.line > w.bottom) w.addPage();
    lines.forEach((ls, k) => {
      const col = b.columns[k];
      // Header labels sit on the bottom line, aligned with their column.
      const offset = height - ls.length * S.line;
      ls.forEach((line, i) => {
        const baseline = w.y + offset + i * S.line + (S.line + S.size * 0.7) / 2;
        const right = col?.numeric === true;
        w.text(
          line,
          right ? (xs[k] ?? 0) + (widths[k] ?? 0) : (xs[k] ?? 0),
          baseline,
          'medium',
          S.size,
          P.colours.ink,
          right ? 'right' : 'left',
        );
      });
    });
    w.y += height + (P.space[0] ?? 0);
    w.hline(P.margin, w.y, total, P.colours.stone, P.line);
    w.y += P.space[0] ?? 0;
  };

  header();
  b.rows.forEach((row, r) => {
    const lines = row.map((cell, k) => cellLines(cell, k, 'regular'));
    const height = Math.max(1, ...lines.map((l) => l.length)) * S.line;
    if (w.y + height > w.bottom) {
      w.addPage();
      header();
    }
    // Alternate rows sit on the field ground, so a long row can be followed across.
    if (r % 2 === 1) w.rect(P.margin, w.y, total, height, P.colours.field);
    lines.forEach((ls, k) => {
      const right = b.columns[k]?.numeric === true;
      ls.forEach((line, i) => {
        const baseline = w.y + i * S.line + (S.line + S.size * 0.7) / 2;
        w.text(
          line,
          right ? (xs[k] ?? 0) + (widths[k] ?? 0) : (xs[k] ?? 0),
          baseline,
          'regular',
          S.size,
          P.colours.ink,
          right ? 'right' : 'left',
        );
      });
    });
    w.y += height;
  });
  w.y += P.space[3] ?? 0;
}

function sectionTitle(w: Writer, text: string) {
  const P = w.print;
  const style = P.heading;
  for (const line of w.wrap(text, w.contentWidth, 'medium', style.size)) {
    w.text(
      line,
      P.margin,
      w.y + (style.line + style.size * 0.7) / 2,
      'medium',
      style.size,
      P.colours.ink,
    );
    w.y += style.line;
  }
  w.y += P.space[3] ?? 0;
}

// -------------------------------------------------------------------- fonts

async function loadFonts(doc: PDFDocument, input: PdfInput): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const faces: Face[] = ['sans-400', 'sans-500', 'sans-600', 'condensed-500'];
  const out: Partial<Fonts> = {};
  for (const face of faces) {
    const load = async (subset: 'latin' | 'latin-ext') => {
      const sfnt = await woffToSfnt(
        await input.loadFont(fontFile(face, subset, 'woff')),
        input.inflate,
      );
      const glyphs = fontkit.create(sfnt);
      return {
        pdf: await doc.embedFont(sfnt, { subset: true, features: { tnum: true } }),
        has: (cp: number) => glyphs.hasGlyphForCodePoint(cp),
      };
    };
    out[face] = { latin: await load('latin'), ext: await load('latin-ext') };
  }
  return out as Fonts;
}

// ------------------------------------------------------------------- report

export async function reportPdf(input: PdfInput): Promise<PdfOutput> {
  const { report, print: P } = input;
  const doc = await PDFDocument.create();
  const title = reportCopy.documentTitle(report.title);
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setSubject(reportCopy.subject);
  doc.setCreator(reportCopy.creator);
  doc.setProducer(`${reportCopy.creator} ${APP_VERSION}`);
  doc.setLanguage('en-GB');
  doc.setCreationDate(input.now);
  doc.setModificationDate(input.now);
  // No author, keywords or other metadata: nothing that could name anyone.
  doc.setAuthor('');
  doc.setKeywords([]);

  const fonts = await loadFonts(doc, input);
  const w = new Writer(doc, fonts, P);

  // Cover: title, subtitle and date in the upper third; what the report holds below.
  w.addPage(false, false);
  w.y = P.pageHeight * 0.28;
  for (const line of w.wrap(report.title, w.contentWidth, 'medium', P.title.size)) {
    w.text(
      line,
      P.margin,
      w.y + (P.title.line + P.title.size * 0.7) / 2,
      'medium',
      P.title.size,
      P.colours.ink,
    );
    w.y += P.title.line;
  }
  w.y += P.space[1] ?? 0;
  w.text(
    report.subtitle,
    P.margin,
    w.y + (P.subheading.line + P.subheading.size * 0.7) / 2,
    'regular',
    P.subheading.size,
    P.colours.graphite,
  );
  w.y += P.subheading.line;
  w.text(
    report.date,
    P.margin,
    w.y + (P.body.line + P.body.size * 0.7) / 2,
    'regular',
    P.body.size,
    P.colours.graphite,
  );
  w.y += P.body.line + (P.space[6] ?? 0);
  for (const line of report.cover) paragraph(w, { kind: 'paragraph', text: line });
  w.y += P.space[4] ?? 0;
  const cover = w.page;
  const contentsTop = w.y;
  w.y = w.bottom - P.small.line;
  w.text(
    reportCopy.cover.generated(APP_VERSION),
    P.margin,
    w.y + (P.small.line + P.small.size * 0.7) / 2,
    'regular',
    P.small.size,
    P.colours.graphite,
  );

  // Page numbers count from the map page; the cover is not numbered.
  const starts: number[] = [];

  // The map, on a landscape page.
  w.addPage(true);
  starts.push(w.bodyPages.length);
  sectionTitle(w, report.contents[0] ?? '');
  paragraph(w, { kind: 'paragraph', text: report.mapIntro, tone: 'graphite', small: true });
  // The picture's own padding sits in the margin, so the caption lines up with the text.
  const pad = input.exportTheme.padding;
  drawMap(w, input.map, {
    x: P.margin - pad,
    y: w.y - pad,
    width: w.contentWidth + pad * 2,
    height: w.bottom - w.y + pad,
  });

  for (const section of report.sections) {
    w.addPage();
    starts.push(w.bodyPages.length);
    sectionTitle(w, section.title);
    for (const b of section.blocks) {
      if (b.kind === 'heading') heading(w, b.text);
      else if (b.kind === 'paragraph') paragraph(w, b);
      else if (b.kind === 'warning') warning(w, b.text);
      else table(w, b);
    }
  }

  // Contents on the cover, with the page each part starts on.
  const pages = w.bodyPages.length;
  w.page = cover;
  w.pageWidth = P.pageWidth;
  w.pageHeight = P.pageHeight;
  w.y = contentsTop;
  const C = P.subheading;
  w.text(
    reportCopy.cover.contents,
    P.margin,
    w.y + (C.line + C.size * 0.7) / 2,
    'medium',
    C.size,
    P.colours.ink,
  );
  w.y += C.line + (P.space[0] ?? 0);
  report.contents.forEach((c, k) => {
    const baseline = w.y + (P.body.line + P.body.size * 0.7) / 2;
    w.text(c, P.margin, baseline, 'regular', P.body.size, P.colours.ink);
    w.text(
      String(starts[k] ?? ''),
      P.margin + Math.min(P.measure, w.contentWidth),
      baseline,
      'regular',
      P.body.size,
      P.colours.graphite,
      'right',
    );
    w.y += P.body.line;
  });

  // Running footer: the title and the page number, on every page after the cover.
  w.bodyPages.forEach((page, k) => {
    w.page = page;
    const { width, height } = page.getSize();
    w.pageWidth = width / PT;
    w.pageHeight = height / PT;
    const baseline = w.pageHeight - P.margin / 2;
    w.text(report.title, P.margin, baseline, 'regular', P.small.size, P.colours.graphite);
    w.text(
      reportCopy.pageOf(k + 1, pages),
      w.pageWidth - P.margin,
      baseline,
      'regular',
      P.small.size,
      P.colours.graphite,
      'right',
    );
  });

  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount(), substituted: [...w.substituted] };
}
