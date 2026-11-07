import { parseDelimited } from './import/delimited';

/** Parse tab-separated text as copied from Excel or Numbers (supports quoted cells). */
export function parseTSV(text: string): string[][] {
  return parseDelimited(text, '\t');
}

function quote(cell: string): string {
  return /[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toTSV(grid: string[][]): string {
  return grid.map((r) => r.map(quote).join('\t')).join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toHTML(grid: string[][]): string {
  const body = grid.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table>${body}</table>`;
}
