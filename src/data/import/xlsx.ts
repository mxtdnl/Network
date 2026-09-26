// XLSX reading. Placeholder until SheetJS can be installed (see CLAUDE.md):
// every call reports that XLSX is unavailable, so the user is told to use CSV.

import type { RawTable } from './table';

export class XlsxUnavailableError extends Error {
  constructor() {
    super('XLSX files cannot be read in this build yet.');
    this.name = 'XlsxUnavailableError';
  }
}

export const parseXlsx: (fileName: string, data: ArrayBuffer) => Promise<RawTable> = () =>
  Promise.reject(new XlsxUnavailableError());
