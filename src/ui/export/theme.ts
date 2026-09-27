// Design tokens for exports (spec §12: tokens are the only source of design
// values). The map, the legend and the caption of an exported picture, and
// every size of the PDF report, are read from src/styles/tokens.css through a
// token source: the page's computed style in the browser, the file itself in
// tests. Lengths are returned in CSS pixels; the PDF converts them to points.

import { readMapTheme, type MapTheme, type TokenSource } from '../map/theme';

export type { TokenSource };

/** CSS pixels per unit (CSS Values 4: 1in = 96px = 25.4mm = 72pt). */
const PX_PER: Record<string, number> = { px: 1, mm: 96 / 25.4, pt: 96 / 72, in: 96 };

/** A length token in CSS pixels; throws when the token is missing or has another unit. */
export function tokenLength(source: TokenSource, name: string): number {
  const value = source(name).trim();
  const m = /^(-?[\d.]+)(px|mm|pt|in)?$/.exec(value);
  const unit = m?.[2] ?? 'px';
  const n = m ? Number.parseFloat(m[1] ?? '') : NaN;
  const factor = PX_PER[unit];
  if (!Number.isFinite(n) || factor === undefined) {
    throw new Error(`Design token ${name} is missing or not a length (${value}).`);
  }
  return n * factor;
}

/** A unitless number token. */
export function tokenNumber(source: TokenSource, name: string): number {
  const n = Number.parseFloat(source(name));
  if (!Number.isFinite(n)) throw new Error(`Design token ${name} is missing or not a number.`);
  return n;
}

/** Tokens of the page, read once per call. */
export function documentTokens(element: Element = document.documentElement): TokenSource {
  const style = getComputedStyle(element);
  return (name) => style.getPropertyValue(name).trim();
}

export interface TextStyle {
  size: number;
  line: number;
}

export interface ExportTheme {
  map: MapTheme;
  field: string;
  fontSans: string;
  fontCondensed: string;
  weights: { regular: string; medium: string; semibold: string };
  padding: number;
  gap: number;
  legendWidth: number;
  /** Legend text: t--1, as on screen. */
  legend: TextStyle;
  legendSectionGap: number;
  legendItemGap: number;
  legendRowGap: number;
  legendDot: number;
  rampHeight: number;
  caption: TextStyle;
  printWidth: number;
  printDpi: number;
  defaultSize: { width: number; height: number };
}

export function readExportTheme(source: TokenSource): ExportTheme {
  const len = (name: string) => tokenLength(source, name);
  return {
    map: readMapTheme(source),
    field: source('--field').trim(),
    fontSans: source('--font-sans').trim(),
    fontCondensed: source('--font-condensed').trim(),
    weights: {
      regular: source('--weight-regular').trim(),
      medium: source('--weight-medium').trim(),
      semibold: source('--weight-semibold').trim(),
    },
    padding: len('--export-padding'),
    gap: len('--export-gap'),
    legendWidth: len('--export-legend-width'),
    legend: { size: len('--t--1-size'), line: len('--t--1-line') },
    // The on-screen legend's spacing (map.css): sections s-3 apart, samples s-1 from their labels.
    legendSectionGap: len('--s-3'),
    legendItemGap: len('--s-1'),
    legendRowGap: len('--s-3'),
    legendDot: len('--s-3'),
    rampHeight: len('--s-2'),
    caption: { size: len('--export-caption-size'), line: len('--export-caption-line') },
    printWidth: len('--export-print-width'),
    printDpi: tokenNumber(source, '--export-print-dpi'),
    defaultSize: { width: len('--export-default-width'), height: len('--export-default-height') },
  };
}

export interface PrintTheme {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  title: TextStyle;
  heading: TextStyle;
  subheading: TextStyle;
  body: TextStyle;
  small: TextStyle;
  measure: number;
  columnGap: number;
  /** Spacing steps s-1 … s-8, in CSS pixels. */
  space: number[];
  colours: { ink: string; graphite: string; stone: string; field: string; paper: string };
  line: number;
}

export function readPrintTheme(source: TokenSource): PrintTheme {
  const len = (name: string) => tokenLength(source, name);
  const text = (role: string): TextStyle => ({
    size: len(`--print-${role}-size`),
    line: len(`--print-${role}-line`),
  });
  return {
    pageWidth: len('--print-page-width'),
    pageHeight: len('--print-page-height'),
    margin: len('--print-margin'),
    title: text('title'),
    heading: text('heading'),
    subheading: text('subheading'),
    body: text('body'),
    small: text('small'),
    measure: len('--print-measure'),
    columnGap: len('--print-column-gap'),
    space: [1, 2, 3, 4, 5, 6, 7, 8].map((k) => len(`--s-${String(k)}`)),
    colours: {
      ink: source('--ink').trim(),
      graphite: source('--graphite').trim(),
      stone: source('--stone').trim(),
      field: source('--field').trim(),
      paper: source('--paper').trim(),
    },
    line: len('--line-width'),
  };
}
