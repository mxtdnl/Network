// Builds each export file from the export context. Shared by the browser
// (export actions) and the tests, so what is tested is what is downloaded;
// only the PNG's rasterising and the download itself need a browser.

import { exportCopy, reportCopy } from '../copy/export';
import type { ExportContext } from './context';
import { composeMap, type MapDocument, type Measure } from './document';
import type { FontLoader, Inflate } from './fonts';
import { exportMap, type ExportMap, type MapState } from './mapScene';
import { buildReport, type ReportModel } from './report';
import { documentToSvg } from './svg';
import { viewSlug } from './tables';
import { readExportTheme, readPrintTheme, type ExportTheme, type TokenSource } from './theme';

export interface ExportDeps {
  tokens: TokenSource;
  measure: Measure;
  loadFont: FontLoader;
  inflate: Inflate;
  now: Date;
  /** docs/method-notes.md as text. */
  notes: string;
}

export interface MapExport {
  doc: MapDocument;
  map: ExportMap;
  theme: ExportTheme;
}

/** The composed map picture: map, legend and caption (names in the caption replaced when anonymised). */
export function mapExport(
  ctx: ExportContext,
  state: MapState,
  deps: Pick<ExportDeps, 'tokens' | 'measure'>,
  caption: string,
  fitTo: { width: number; height: number } | null = null,
): MapExport {
  const theme = readExportTheme(deps.tokens);
  const map = exportMap(
    ctx,
    state,
    theme,
    (text) => deps.measure(text, 'label', theme.map.labelSize),
    fitTo,
  );
  const doc = composeMap({
    scene: map.scene,
    model: map.model,
    extras: map.extras,
    theme,
    caption: ctx.names.text(caption),
    measure: deps.measure,
    title: reportCopy.mapTitle(ctx.names.text(ctx.project.meta.title)),
  });
  return { doc, map, theme };
}

export function mapFileName(ctx: ExportContext, ext: 'png' | 'svg'): string {
  return exportCopy.files.map(viewSlug(ctx), ext);
}

export async function svgExport(
  ctx: ExportContext,
  state: MapState,
  deps: ExportDeps,
  caption: string,
): Promise<{ fileName: string; text: string; doc: MapDocument }> {
  const { doc, map, theme } = mapExport(ctx, state, deps, caption);
  const description = [reportCopy.map.intro(map.layerName), ctx.names.text(caption)]
    .filter((s) => s.trim() !== '')
    .join(' ');
  const text = await documentToSvg(doc, theme, deps.loadFont, description);
  return { fileName: mapFileName(ctx, 'svg'), text, doc };
}

export interface PdfExport {
  fileName: string;
  bytes: Uint8Array;
  report: ReportModel;
  doc: MapDocument;
  pages: number;
  substituted: string[];
}

export async function pdfExport(
  ctx: ExportContext,
  state: MapState,
  deps: ExportDeps,
  caption: string,
): Promise<PdfExport> {
  // The map page is A4 landscape: the members are fitted into the space beside
  // the legend, at full size, so legend and labels print at their token sizes.
  const print = readPrintTheme(deps.tokens);
  const ex = readExportTheme(deps.tokens);
  const pageW = print.pageHeight - print.margin * 2 + ex.padding * 2;
  const pageH =
    print.pageWidth -
    print.margin * 2 -
    print.heading.line -
    (print.space[3] ?? 0) -
    print.small.line * 2 -
    (print.space[1] ?? 0) +
    ex.padding;
  const captionH = caption.trim() === '' ? 0 : ex.gap + ex.caption.line * 2;
  const fitTo = {
    width: pageW - ex.padding * 2 - ex.gap - ex.legendWidth,
    height: pageH - ex.padding * 2 - captionH,
  };
  const { doc, map, theme } = mapExport(ctx, state, deps, caption, fitTo);
  const report = buildReport(ctx, { notes: deps.notes, now: deps.now, layerName: map.layerName });
  const { reportPdf } = await import('./pdf');
  const out = await reportPdf({
    report,
    map: doc,
    exportTheme: theme,
    print,
    loadFont: deps.loadFont,
    inflate: deps.inflate,
    now: deps.now,
  });
  const date = deps.now.toISOString().slice(0, 10);
  return {
    fileName: exportCopy.files.report(
      `${date}${exportCopy.suffix(ctx.anonymised, ctx.reanalysed)}`,
    ),
    bytes: out.bytes,
    report,
    doc,
    pages: out.pages,
    substituted: out.substituted,
  };
}
