/**
 * Formula language for computed rows. Evaluated once per month.
 *
 *   [Sales] * 6%                 a row in the same table, by its label
 *   [Main account].[Balance]     a row in another table (any sheet), by table name
 *   PREV([Sales], 2) * 50%       the value 2 months earlier
 *   SUM([Rent], [Utilities])     also MIN, MAX, ABS, ROUND(x, digits), IF(cond, a, b)
 *
 * Operators: + - * / ( ), postfix %, comparisons > < >= <= = <> (true = 1).
 * Full-width characters typed with Chinese input (【】（）＋－＊／％，) are accepted.
 */

export type Node =
  | { k: 'num'; v: number }
  | { k: 'ref'; table: string | null; row: string }
  | { k: 'neg'; e: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

export class FormulaError extends Error {}

const FULL_WIDTH: Record<string, string> = {
  '【': '[', '】': ']', '［': '[', '］': ']', '（': '(', '）': ')', '＋': '+', '－': '-', '−': '-',
  '＊': '*', '×': '*', '／': '/', '÷': '/', '％': '%', '，': ',', '．': '.', '＝': '=', '＜': '<', '＞': '>',
  '　': ' ',
};

export function normalizeFormula(src: string): string {
  return src
    .replace(/[【】［］（）＋－−＊×／÷％，．＝＜＞　]/g, (c) => FULL_WIDTH[c])
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/^\s*=/, '');
}

type Tok = { t: 'num'; v: string; n: number } | { t: 'ref' | 'id' | 'op'; v: string };

function tokenize(src: string): Tok[] {
  const s = normalizeFormula(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) throw new FormulaError('Missing ]');
      out.push({ t: 'ref', v: s.slice(i + 1, j).trim() });
      i = j + 1;
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      // No thousands separators here: a comma separates function arguments.
      const m = /^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
      if (!m) throw new FormulaError(`Bad number near "${s.slice(i, i + 8)}"`);
      const v = Number(m[0]);
      i += m[0].length;
      out.push({ t: 'num', v: m[0], n: v });
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))!;
      out.push({ t: 'id', v: m[0].toUpperCase() });
      i += m[0].length;
    } else {
      const two = s.slice(i, i + 2);
      if (two === '>=' || two === '<=' || two === '<>') {
        out.push({ t: 'op', v: two });
        i += 2;
      } else if ('+-*/(),%.<>='.includes(ch)) {
        out.push({ t: 'op', v: ch });
        i++;
      } else {
        throw new FormulaError(`Unexpected "${ch}"`);
      }
    }
  }
  return out;
}

const FUNCS: Record<string, [number, number]> = {
  SUM: [1, 99], MIN: [1, 99], MAX: [1, 99], ABS: [1, 1], ROUND: [1, 2], PREV: [1, 2], IF: [3, 3],
};

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  if (toks.length === 0) throw new FormulaError('Empty formula');
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`);
    i++;
  };

  function compare(): Node {
    let a = additive();
    while (peek()?.t === 'op' && ['>', '<', '>=', '<=', '=', '<>'].includes(peek().v)) {
      const op = toks[i++].v;
      a = { k: 'bin', op, a, b: additive() };
    }
    return a;
  }
  function additive(): Node {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[i++].v;
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = toks[i++].v;
      a = { k: 'bin', op, a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (isOp('-')) {
      i++;
      return { k: 'neg', e: unary() };
    }
    if (isOp('+')) {
      i++;
      return unary();
    }
    let e = primary();
    while (isOp('%')) {
      i++;
      e = { k: 'bin', op: '*', a: e, b: { k: 'num', v: 0.01 } };
    }
    return e;
  }
  function primary(): Node {
    const tok = peek();
    if (!tok) throw new FormulaError('Formula ends too early');
    if (tok.t === 'num') {
      i++;
      return { k: 'num', v: tok.n };
    }
    if (tok.t === 'ref') {
      i++;
      // [Table].[Row]
      if (isOp('.') && toks[i + 1]?.t === 'ref') {
        i++;
        const row = toks[i++].v;
        return { k: 'ref', table: tok.v, row };
      }
      return { k: 'ref', table: null, row: tok.v };
    }
    if (tok.t === 'id') {
      i++;
      const arity = FUNCS[tok.v];
      if (!arity) throw new FormulaError(`Unknown function ${tok.v}`);
      expect('(');
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(compare());
        while (isOp(',')) {
          i++;
          args.push(compare());
        }
      }
      expect(')');
      if (args.length < arity[0] || args.length > arity[1]) {
        throw new FormulaError(`${tok.v} takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} argument(s)`);
      }
      if (tok.v === 'PREV' && args[1] && args[1].k !== 'num') {
        throw new FormulaError('PREV needs a plain number of months');
      }
      return { k: 'call', name: tok.v, args };
    }
    if (isOp('(')) {
      i++;
      const e = compare();
      expect(')');
      return e;
    }
    throw new FormulaError(`Unexpected "${tok.v}"`);
  }

  const node = compare();
  if (i < toks.length) throw new FormulaError(`Unexpected "${toks[i].v}"`);
  return node;
}

/** Evaluate for one month. `ref` resolves a row reference; `shift` moves the month (for PREV). */
export interface EvalContext {
  ref(table: string | null, row: string, monthOffset: number): number;
}

export function evaluate(node: Node, ctx: EvalContext, offset = 0): number {
  switch (node.k) {
    case 'num':
      return node.v;
    case 'ref':
      return ctx.ref(node.table, node.row, offset);
    case 'neg':
      return -evaluate(node.e, ctx, offset);
    case 'bin': {
      const a = evaluate(node.a, ctx, offset);
      const b = evaluate(node.b, ctx, offset);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new FormulaError('Division by zero');
          return a / b;
        case '>': return a > b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '=': return Math.abs(a - b) < 1e-9 ? 1 : 0;
        case '<>': return Math.abs(a - b) < 1e-9 ? 0 : 1;
      }
      throw new FormulaError(`Bad operator ${node.op}`);
    }
    case 'call': {
      const { name, args } = node;
      if (name === 'PREV') {
        const n = args[1] ? (args[1] as { v: number }).v : 1;
        return evaluate(args[0], ctx, offset - Math.round(n));
      }
      if (name === 'IF') {
        return evaluate(args[0], ctx, offset) !== 0 ? evaluate(args[1], ctx, offset) : evaluate(args[2], ctx, offset);
      }
      const vals = args.map((a) => evaluate(a, ctx, offset));
      switch (name) {
        case 'SUM': return vals.reduce((x, y) => x + y, 0);
        case 'MIN': return Math.min(...vals);
        case 'MAX': return Math.max(...vals);
        case 'ABS': return Math.abs(vals[0]);
        case 'ROUND': {
          const f = 10 ** Math.round(vals[1] ?? 0);
          return Math.round(vals[0] * f) / f;
        }
      }
      throw new FormulaError(`Unknown function ${name}`);
    }
  }
}

/** Row references used by a formula (for showing what it depends on). */
export function references(node: Node): { table: string | null; row: string }[] {
  switch (node.k) {
    case 'ref': return [{ table: node.table, row: node.row }];
    case 'neg': return references(node.e);
    case 'bin': return [...references(node.a), ...references(node.b)];
    case 'call': return node.args.flatMap(references);
    default: return [];
  }
}
