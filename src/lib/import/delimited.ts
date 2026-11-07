/** Decode file bytes: UTF-8 if valid, otherwise GB18030 (Excel's default for Chinese CSV). */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('gb18030').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

/** Pick the separator that splits the first lines most consistently. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestScore = 0;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => parseDelimited(l, d)[0]?.length ?? 1);
    const min = Math.min(...counts);
    const score = min > 1 && counts.every((c) => c === counts[0]) ? min + 100 : min;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** RFC 4180-style parser: quoted cells may contain separators, newlines and "" quotes. */
export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === sep) {
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
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function readDelimited(bytes: Uint8Array): string[][] {
  const text = decodeText(bytes);
  return parseDelimited(text, detectDelimiter(text)).filter((r) => r.some((c) => c.trim() !== ''));
}
