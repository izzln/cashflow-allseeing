/**
 * Three-way merge for workbook JSON, used when two windows edit the same file.
 *
 * Given the last version both sides agreed on (base), our version (mine) and
 * the stored version (theirs), keep both sides' changes:
 * - objects merge key by key, so edits to different cells never clash;
 * - arrays of objects with an `id` (sheets, tables, rows) merge by id: additions
 *   from either side are kept, deletions from either side win, and order follows
 *   whichever side reordered;
 * - when both sides changed the same value differently, mine wins.
 */

type Json = unknown;

function isObj(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIdArray(v: Json): v is { id: string }[] {
  return Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === 'string');
}

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

export function merge3<T>(base: T, mine: T, theirs: T): T {
  return mergeAny(base, mine, theirs) as T;
}

function mergeAny(base: Json, mine: Json, theirs: Json): Json {
  if (deepEqual(mine, theirs)) return mine;
  if (deepEqual(base, mine)) return theirs;
  if (deepEqual(base, theirs)) return mine;
  if (isObj(mine) && isObj(theirs)) return mergeObj(isObj(base) ? base : {}, mine, theirs);
  if (isIdArray(mine) && isIdArray(theirs)) {
    return mergeIdArray(isIdArray(base) ? base : [], mine, theirs);
  }
  return mine;
}

function mergeObj(
  base: Record<string, Json>,
  mine: Record<string, Json>,
  theirs: Record<string, Json>,
): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
    const v = mergeAny(base[k], mine[k], theirs[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function ids(list: { id: string }[]): string[] {
  return list.map((x) => x.id);
}

function mergeIdArray(base: { id: string }[], mine: { id: string }[], theirs: { id: string }[]) {
  const byId = (l: { id: string }[]) => new Map(l.map((x) => [x.id, x]));
  const B = byId(base);
  const M = byId(mine);
  const T = byId(theirs);

  // Which items survive, and their merged content.
  const kept = new Map<string, Json>();
  for (const id of new Set([...M.keys(), ...T.keys()])) {
    const inM = M.has(id);
    const inT = T.has(id);
    if (inM && inT) kept.set(id, mergeAny(B.get(id), M.get(id), T.get(id)));
    else if (!B.has(id)) kept.set(id, inM ? M.get(id) : T.get(id)); // added on one side
    // else: deleted on one side → drop
  }

  // Order: follow mine if mine reordered the shared items, else theirs.
  const reordered = (side: { id: string }[]) => {
    const sideIds = ids(side).filter((id) => B.has(id));
    const baseIds = ids(base).filter((id) => sideIds.includes(id));
    return !deepEqual(sideIds, baseIds);
  };
  const [primary, secondary] = reordered(mine) || !reordered(theirs) ? [mine, theirs] : [theirs, mine];
  const order = ids(primary).filter((id) => kept.has(id));
  // Insert items only the other side has, right after their neighbour there.
  const sec = ids(secondary);
  sec.forEach((id, i) => {
    if (!kept.has(id) || order.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(sec[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, id);
  });
  return order.map((id) => kept.get(id));
}
