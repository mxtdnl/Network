// File actions: open and save .ona.json projects, load the demo, and read
// import files into tables. Everything happens in the browser.

import { parseCsv } from '../../data/import/csv';
import type { RawTable } from '../../data/import/table';
import { parseProject, projectFileName, serialiseProject } from '../../data/projectFile';
import { importCopy } from '../copy/import';
import { projectCopy } from '../copy/data';
import { useAppStore } from './store';

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function openProjectFile(file: File): Promise<void> {
  const { setProject, setStatus } = useAppStore.getState();
  try {
    const project = parseProject(await file.text());
    setProject(project, { text: projectCopy.opened(project.meta.title), tone: 'info' });
  } catch (e) {
    setStatus({ text: projectCopy.openFailed(file.name, reason(e)), tone: 'error' });
  }
}

export function saveProjectFile(): void {
  const { data, setStatus } = useAppStore.getState();
  if (!data.project) {
    setStatus({ text: projectCopy.noProjectToSave, tone: 'error' });
    return;
  }
  const name = projectFileName(data.project);
  // The file records whether names were hidden, so it reopens the same way.
  const anonymise = useAppStore.getState().ui.anonymise;
  const project = { ...data.project, settings: { ...data.project.settings, anonymise } };
  const blob = new Blob([serialiseProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus({ text: projectCopy.saved(name), tone: 'info' });
}

export async function loadDemo(): Promise<void> {
  const { setProject, setStatus } = useAppStore.getState();
  try {
    const { default: text } = await import('../../demo/demo.ona.json?raw');
    setProject(parseProject(text), { text: projectCopy.demoLoaded, tone: 'info' });
  } catch (e) {
    setStatus({ text: projectCopy.openFailed('The demo', reason(e)), tone: 'error' });
  }
}

export class ImportReadError extends Error {}

/** Reads a CSV or XLSX file into a table of text cells. */
export async function readImportFile(file: File): Promise<RawTable> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(file.name, await file.text());
  if (lower.endsWith('.xlsx')) {
    const { parseXlsx } = await import('../../data/import/xlsx');
    return parseXlsx(file.name, await file.arrayBuffer());
  }
  throw new ImportReadError(importCopy.unsupportedType);
}
