/** Client side CSV export used by the data table, the console and the assistant. */

const escapeCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  // a leading = or + would be executed by a spreadsheet, so it is neutralised
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => escapeCell(row[column])).join(','));
  return lines.join('\r\n');
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadCsv = (filename: string, columns: string[], rows: Record<string, unknown>[]): void =>
  downloadText(filename.endsWith('.csv') ? filename : `${filename}.csv`, toCsv(columns, rows));

export const downloadJson = (filename: string, payload: unknown): void =>
  downloadText(
    filename.endsWith('.json') ? filename : `${filename}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
