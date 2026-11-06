/** Parse tab-separated text as copied from Excel or Numbers (supports quoted cells). */
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
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
