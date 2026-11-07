import { excelSerialToDate } from '../dates';

/**
 * Minimal .xlsx reader: enough to pull cell text out of exported spreadsheets
 * (Excel, Numbers, Feishu, Huoban, bank exports). Dates come out as YYYY-MM-DD.
 * Uses the browser's built-in DecompressionStream, so no library is needed.
 */

export interface SheetData {
  name: string;
  rows: string[][];
}

// ---------- zip ----------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: Uint8Array): Promise<Map<string, () => Promise<string>>> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<string>>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .xlsx file');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + size);
    files.set(name.replace(/^\//, ''), async () => {
      if (method === 0) return dec.decode(raw);
      if (method === 8) return dec.decode(await inflateRaw(raw));
      throw new Error('Unsupported compression in .xlsx file');
    });
  }
  return files;
}

// ---------- xml helpers (the files are machine-written and regular) ----------

const P = '(?:[\\w.-]+:)?'; // optional namespace prefix, e.g. <x:c>

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]!;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : null;
}

function allText(xml: string): string {
  // Concatenate <t> runs, skipping phonetic hints (<rPh>).
  const body = xml.replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?</${P}rPh>`, 'g'), '');
  let out = '';
  for (const m of body.matchAll(new RegExp(`<${P}t\\b[^>]*>([\\s\\S]*?)</${P}t>`, 'g'))) out += m[1];
  return decodeXml(out);
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const DATE_FMT_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);

function isDateFormat(code: string): boolean {
  const s = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
  return /[yd]/i.test(s) || /m/i.test(s.replace(/[^ymdhs]/gi, '')) && !/^[#0.,%\s-]*$/.test(s);
}

function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(new RegExp(`<${P}numFmt\\b([^>]*)/?>`, 'g'))) {
    custom.set(Number(attr(m[1], 'numFmtId')), attr(m[1], 'formatCode') ?? '');
  }
  const xfs = new RegExp(`<${P}cellXfs\\b[^>]*>([\\s\\S]*?)</${P}cellXfs>`).exec(stylesXml)?.[1] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(new RegExp(`<${P}xf\\b([^>]*)`, 'g'))) {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    if (DATE_FMT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) out.add(i);
    i++;
  }
  return out;
}

function parseSheet(xml: string, shared: string[], dates: Set<number>): string[][] {
  const rows: string[][] = [];
  const rowRe = new RegExp(`<${P}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}row>)`, 'g');
  const cellRe = new RegExp(`<${P}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}c>)`, 'g');
  const valueRe = new RegExp(`<${P}v\\b[^>]*>([\\s\\S]*?)</${P}v>`);
  for (const rm of xml.matchAll(rowRe)) {
    const r = Number(attr(rm[1], 'r') ?? rows.length + 1) - 1;
    const line: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(cellRe)) {
      const ref = attr(cm[1], 'r');
      const c = ref ? colIndex(ref) : next;
      next = c + 1;
      const type = attr(cm[1], 't') ?? 'n';
      const style = Number(attr(cm[1], 's') ?? 0);
      const inner = cm[2] ?? '';
      const v = valueRe.exec(inner)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = allText(inner);
      else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') text = decodeXml(v ?? '');
      else if (v !== undefined) {
        const n = Number(v);
        text = dates.has(style) ? (excelSerialToDate(n) ?? v) : v;
      }
      line[c] = text;
    }
    rows[r] = Array.from(line, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []).filter((r) => r.some((c) => c.trim() !== ''));
}

export async function readXlsx(bytes: Uint8Array): Promise<SheetData[]> {
  const files = await unzip(bytes);
  const read = async (path: string) => (files.has(path) ? files.get(path)!() : null);
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('Not a valid .xlsx file');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(new RegExp(`<${P}Relationship\\b([^>]*)/?>`, 'g'))) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = sharedXml
    ? [...sharedXml.matchAll(new RegExp(`<${P}si\\b[^>]*>([\\s\\S]*?)</${P}si>`, 'g'))].map((m) => allText(m[1]))
    : [];
  const dates = dateStyles(await read('xl/styles.xml'));
  const out: SheetData[] = [];
  for (const m of workbook.matchAll(new RegExp(`<${P}sheet\\b([^>]*)/?>`, 'g'))) {
    const name = attr(m[1], 'name') ?? `Sheet${out.length + 1}`;
    const rid = /\br:id="([^"]*)"|\bid="([^"]*)"/.exec(m[1]);
    const path = targets.get(rid?.[1] ?? rid?.[2] ?? '') ?? `xl/worksheets/sheet${out.length + 1}.xml`;
    const xml = await read(path.replace(/\/\.\//g, '/'));
    if (xml) out.push({ name, rows: parseSheet(xml, shared, dates) });
  }
  return out;
}

/** Read a CSV/TSV or .xlsx file into sheets of text cells. */
export async function readSpreadsheet(name: string, bytes: Uint8Array): Promise<SheetData[]> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return readXlsx(bytes);
  if (/\.(xls|numbers)$/i.test(name)) {
    throw new Error('Please save this file as .xlsx or .csv first (old .xls and .numbers files are not supported).');
  }
  const { readDelimited } = await import('./delimited');
  return [{ name: name.replace(/\.[^.]+$/, ''), rows: readDelimited(bytes) }];
}
