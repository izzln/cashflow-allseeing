const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  // Avoid showing "-0".
  return nf.format(Object.is(n, -0) ? 0 : n);
}

/** Map full-width characters (common with Chinese input methods) to ASCII. */
function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[－−–]/g, '-')
    .replace(/．/g, '.')
    .replace(/[，]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');
}

/**
 * Parse user or clipboard input into a number.
 * Returns null for "clear this cell" (blank or a lone dash) and undefined when
 * the text is not a number.
 */
export function parseNumber(input: string): number | null | undefined {
  let s = toHalfWidth(input).trim();
  if (s === '' || s === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s,¥$€£]/g, '').replace(/^(RMB|CNY|USD)/i, '');
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}
