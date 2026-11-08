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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A copied cell's formatting: its tint preset id and text alignment (when set). */
export interface CellFormat {
  s?: string;
  a?: 'left' | 'center' | 'right';
}

/**
 * HTML for other apps (Numbers and Excel read the inline text-align), plus data-cf-* attributes
 * so a paste into this app (another window too) restores tints and alignment exactly.
 */
export function toHTML(grid: string[][], formats?: CellFormat[][]): string {
  const td = (c: string, f?: CellFormat) => {
    const attrs = [f?.s ? ` data-cf-s="${esc(f.s)}"` : '', f?.a ? ` data-cf-a="${f.a}" style="text-align:${f.a}"` : ''].join('');
    return `<td${attrs}>${esc(c)}</td>`;
  };
  const body = grid.map((r, i) => `<tr>${r.map((c, j) => td(c, formats?.[i]?.[j])).join('')}</tr>`).join('');
  return `<table${formats ? ' data-cf="1"' : ''}>${body}</table>`;
}

/** The formats of a block copied from this app, read back from its HTML; null for anything else. */
export function formatsFromHTML(html: string): CellFormat[][] | null {
  if (!html.includes('data-cf="1"') || typeof DOMParser === 'undefined') return null;
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table[data-cf="1"]');
  if (!table) return null;
  return [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => {
      const f: CellFormat = {};
      const s = td.getAttribute('data-cf-s');
      const a = td.getAttribute('data-cf-a');
      if (s) f.s = s;
      if (a === 'left' || a === 'center' || a === 'right') f.a = a;
      return f;
    }),
  );
}
