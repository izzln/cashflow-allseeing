import { describe, expect, it } from 'vitest';
import { fromSnapshot, importedName, LocalFileStore, snapshotFilename, toSnapshot, type KV } from '../src/lib/files';
import { starterWorkbook } from '../src/lib/model';

function memKV(init: Record<string, string> = {}): KV & { m: Map<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe('LocalFileStore', () => {
  it('creates, lists newest first, renames, duplicates and deletes', async () => {
    const s = new LocalFileStore(memKV());
    const a = await s.create('A');
    await new Promise((r) => setTimeout(r, 5));
    const b = await s.create('B');
    expect((await s.list()).map((f) => f.name)).toEqual(['B', 'A']);
    await s.rename(a.id, '  Budget 2027 ');
    expect((await s.load(a.id))?.meta.name).toBe('Budget 2027');
    const c = await s.duplicate(a.id);
    expect(c?.name).toBe('Budget 2027 copy');
    await s.remove(b.id);
    expect(await s.load(b.id)).toBeNull();
    expect(await s.list()).toHaveLength(2);
  });

  it('rejects a save based on an old revision unless forced', async () => {
    const s = new LocalFileStore(memKV());
    const f = await s.create('F');
    const wb = starterWorkbook();
    const first = await s.save(f.id, wb, f.rev);
    expect(first.ok).toBe(true);
    // A second window still holds rev 1.
    const stale = await s.save(f.id, wb, f.rev);
    expect(stale).toMatchObject({ ok: false, reason: 'conflict' });
    const forced = await s.save(f.id, wb, f.rev, true);
    expect(forced.ok && forced.meta.rev).toBe(3);
  });

  it('turns the phase 1 single workbook into a file', async () => {
    const wb = starterWorkbook();
    const kv = memKV({ 'cashflow-allseeing.workbook.v1': JSON.stringify(wb) });
    const s = new LocalFileStore(kv);
    const list = await s.list();
    expect(list.map((f) => f.name)).toEqual(['My cash flow']);
    expect((await s.load(list[0].id))?.wb.sheets[0].name).toBe('Operating');
    expect(kv.m.has('cashflow-allseeing.workbook.v1')).toBe(false);
  });
});

describe('snapshots', () => {
  it('round-trips and accepts old bare backups', () => {
    const wb = starterWorkbook();
    const snap = JSON.parse(JSON.stringify(toSnapshot('Plan', wb)));
    expect(fromSnapshot(snap, 'x')?.name).toBe('Plan');
    expect(fromSnapshot(JSON.parse(JSON.stringify(wb)), 'old backup')?.name).toBe('old backup');
    expect(fromSnapshot({ hello: 1 }, 'x')).toBeNull();
  });

  it('builds a safe dated file name', () => {
    expect(snapshotFilename('A/B: plan', new Date(2026, 10, 7))).toBe('A-B- plan 2026-11-07.json');
  });

  it('names a reopened snapshot so it differs from the original', () => {
    expect(importedName('Plan', ['Other'])).toBe('Plan');
    expect(importedName('Plan', ['Plan'], '2026-11-07')).toBe('Plan (snapshot 2026-11-07)');
    expect(importedName('Plan', ['Plan', 'Plan (snapshot)'])).toBe('Plan (snapshot) 2');
  });
});
