// Export actions (spec §11): gather the state on screen, build the export
// context under the two settings (anonymisation, signed-layer exclusion),
// build the file and download it. Every download is a blob: URL, which the
// Content Security Policy allows; nothing leaves the browser.

import { EngineClient, type AnalysisInput } from '../engineClient';
import { exportCopy } from '../copy/export';
import { exportContext, type ExportContext, type ExportRequest } from '../export/context';
import type { FontRole, Measure } from '../export/document';
import { browserInflate } from '../export/fonts';
import { fetchFont } from '../export/fontAssets';
import type { MapState } from '../export/mapScene';
import {
  formalInformalCsv,
  memberMetricsCsv,
  metricsTableCsv,
  networkMetricsCsv,
  type ExportFile,
  type TableSpec,
} from '../export/tables';
import { documentTokens, readExportTheme, type ExportTheme } from '../export/theme';
import { documentToPng, fontFor, pngScale } from '../export/canvas';
import { sharedLayout } from '../map/useMapModel';
import { currentMapViewport } from '../map/viewport';
import { useAppStore } from './store';

export type MapFormat = 'png' | 'svg';
export type Resolution = 'x1' | 'x2' | 'print';
export type TableKind = 'members' | 'network' | 'formalInformal';

/** The export settings saved in the project: the signed-layer exclusion (spec §10). */
export function setExcludeSigned(on: boolean): void {
  useAppStore.getState().updateProjectViews((p) => ({
    ...p,
    settings: { ...p.settings, exclude_signed_from_exports: on },
  }));
}

function request(): ExportRequest | null {
  const s = useAppStore.getState();
  const project = s.data.project;
  const result = s.results.current;
  if (!project || !result || result.memberIds.length !== project.members.length) return null;
  return {
    project,
    result,
    map: s.map,
    weights: s.weights,
    anonymise: s.ui.anonymise,
    excludeSigned: project.settings.exclude_signed_from_exports,
  };
}

/** Runs one analysis on a worker of its own, so the analysis on screen and its tools are untouched. */
async function analyseSeparately(input: AnalysisInput) {
  const client = new EngineClient();
  try {
    return await client.analyse(input).promise;
  } finally {
    client.dispose();
  }
}

async function context(): Promise<ExportContext> {
  const r = request();
  if (!r) throw new Error(exportCopy.noAnalysis);
  return exportContext(r, analyseSeparately);
}

function mapState(): MapState {
  const s = useAppStore.getState();
  const n = s.data.project?.members.length ?? 0;
  const path = s.tools.path;
  return {
    positions: sharedLayout.nodes.length === n ? sharedLayout.snapshot() : null,
    layoutKey: sharedLayout.currentKey,
    viewport: currentMapViewport(),
    revision: s.data.revision,
    group: s.selection.group,
    path:
      path?.status === 'ready' && path.result
        ? { members: path.result.members, inputKey: path.inputKey }
        : null,
  };
}

/** Text widths with the page's own fonts, loaded first so the canvas measures Fira, not a fallback. */
async function browserMeasure(theme: ExportTheme): Promise<Measure> {
  const roles: FontRole[] = ['label', 'group', 'regular', 'medium'];
  await Promise.all(roles.map((r) => document.fonts.load(fontFor(theme, r, 12))));
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw on a canvas.');
  const cache = new Map<string, number>();
  return (text, role, size) => {
    const key = `${role}|${String(size)}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.font = fontFor(theme, role, size);
      w = ctx.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}

function download(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  });
}

/** CSV with a byte-order mark, so spreadsheet programs read it as UTF-8. */
function downloadCsv(file: ExportFile): void {
  download(file.fileName, new Blob(['﻿', file.text], { type: 'text/csv;charset=utf-8' }));
}

function status(text: string, tone: 'info' | 'error' = 'info') {
  useAppStore.getState().setStatus({ text, tone });
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function deps() {
  const tokens = documentTokens();
  const theme = readExportTheme(tokens);
  return { tokens, theme, measure: await browserMeasure(theme) };
}

export async function exportMapFile(
  format: MapFormat,
  resolution: Resolution,
  caption: string,
): Promise<string | null> {
  try {
    const ctx = await context();
    const { tokens, theme, measure } = await deps();
    const files = await import('../export/files');
    if (format === 'svg') {
      const notes = '';
      const out = await files.svgExport(
        ctx,
        mapState(),
        { tokens, measure, loadFont: fetchFont, inflate: browserInflate, now: new Date(), notes },
        caption,
      );
      download(out.fileName, new Blob([out.text], { type: 'image/svg+xml' }));
      status(exportCopy.map.exported(out.fileName));
      return out.fileName;
    }
    const { doc } = files.mapExport(ctx, mapState(), { tokens, measure }, caption);
    const blob = await documentToPng(doc, theme, pngScale(resolution, doc, theme));
    const fileName = files.mapFileName(ctx, 'png');
    download(fileName, blob);
    status(exportCopy.map.exported(fileName));
    return fileName;
  } catch (e) {
    status(exportCopy.map.failed(reason(e)), 'error');
    return null;
  }
}

export async function exportTableFile(kind: TableKind): Promise<string | null> {
  try {
    const ctx = await context();
    const file =
      kind === 'members'
        ? memberMetricsCsv(ctx)
        : kind === 'network'
          ? networkMetricsCsv(ctx)
          : formalInformalCsv(ctx);
    if (!file) throw new Error(exportCopy.tables.formalInformalUnavailable);
    downloadCsv(file);
    status(exportCopy.tables.exported(file.fileName));
    return file.fileName;
  } catch (e) {
    status(exportCopy.tables.failed(reason(e)), 'error');
    return null;
  }
}

/** The metrics table view's own export (D66), under the export settings. */
export async function exportMetricsTable(spec: TableSpec): Promise<string | null> {
  try {
    const file = metricsTableCsv(await context(), spec);
    downloadCsv(file);
    return file.fileName;
  } catch (e) {
    status(exportCopy.tables.failed(reason(e)), 'error');
    return null;
  }
}

export async function exportReportFile(caption: string): Promise<string | null> {
  try {
    const ctx = await context();
    const { tokens, measure } = await deps();
    const [{ pdfExport }, { default: notes }] = await Promise.all([
      import('../export/files'),
      import('../../../docs/method-notes.md?raw'),
    ]);
    const out = await pdfExport(
      ctx,
      mapState(),
      { tokens, measure, loadFont: fetchFont, inflate: browserInflate, now: new Date(), notes },
      caption,
    );
    download(
      out.fileName,
      new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    );
    status(exportCopy.report.exported(out.fileName));
    return out.fileName;
  } catch (e) {
    status(exportCopy.report.failed(reason(e)), 'error');
    return null;
  }
}
