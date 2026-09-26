// CSV for the table export (RFC 4180: quoted when a field holds a comma,
// quote or line break; quotes doubled; CRLF line ends) and a download through
// an object URL, which the Content Security Policy allows (no network request).

export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export function downloadText(fileName: string, text: string, type: string): void {
  // A byte-order mark so spreadsheet programs read the file as UTF-8.
  const blob = new Blob(['﻿', text], { type: `${type};charset=utf-8` });
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
