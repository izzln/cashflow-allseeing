import { describe, expect, it } from 'vitest';
import {
  buildExport,
  exportFilename,
  fromExport,
  importedName,
  LocalFileStore,
  type KV,
} from '../src/lib/files';
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

const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('LocalFileStore', () => {
  it('creates, lists newest first, renames, duplicates and deletes', async () => {
    const s = new LocalFileStore(memKV());
    const a = await s.create('A');
    await new Promise((r) => setTimeout(r, 5));
    const b = await s.create('B');
    expect((await s.list()).map((f) => f.name)).toEqual(['B', 'A']);
    await s.rename(a.id, '  Budget 2027 ');
    expect((await s.load(a.id))?.meta.name).toBe('Budget 2027');
    await s.takeSnapshot(a.id, 'Before changes');
    const c = await s.duplicate(a.id);
    expect(c?.name).toBe('Budget 2027 copy');
    expect(await s.listSnapshots(c!.id)).toHaveLength(1);
    await s.remove(b.id);
    expect(await s.load(b.id)).toBeNull();
    expect(await s.list()).toHaveLength(2);
  });

  it('rejects a save based on an old revision', async () => {
    const s = new LocalFileStore(memKV());
    const f = await s.create('F');
    const wb = starterWorkbook();
    expect((await s.save(f.id, wb, f.rev)).ok).toBe(true);
    // A second window still holds rev 1: it must merge and retry.
    expect(await s.save(f.id, wb, f.rev)).toMatchObject({ ok: false, reason: 'conflict' });
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

  it('takes, lists, loads and deletes manual snapshots', async () => {
    const s = new LocalFileStore(memKV());
    const f = await s.create('F');
    const snap = await s.takeSnapshot(f.id, 'Board meeting', new Date(2026, 10, 7));
    expect(snap).toMatchObject({ label: 'Board meeting', kind: 'manual', asOf: '2026-11' });
    expect((await s.loadSnapshot(f.id, snap.id))?.wb.sheets[0].name).toBe('Operating');
    await s.deleteSnapshot(f.id, snap.id);
    expect(await s.listSnapshots(f.id)).toEqual([]);
  });
});

describe('month-end snapshots', () => {
  async function fileFrom(created: Date) {
    const kv = memKV();
    const s = new LocalFileStore(kv);
    const f = await s.create('F');
    // Pretend the file was created and last saved at `created`.
    const idx = JSON.parse(kv.m.get('cashflow-allseeing.files')!);
    idx[0].createdAt = idx[0].updatedAt = created.getTime();
    kv.m.set('cashflow-allseeing.files', JSON.stringify(idx));
    return { s, id: f.id };
  }

  it('does nothing before the first month has ended', async () => {
    const { s, id } = await fileFrom(new Date(2026, 10, 2));
    expect(await s.ensureMonthEnd(id, new Date(2026, 10, 30))).toBeNull();
  });

  it('freezes last month once, labelled with that month', async () => {
    const { s, id } = await fileFrom(new Date(2026, 9, 20));
    const snap = await s.ensureMonthEnd(id, new Date(2026, 10, 3));
    expect(snap).toMatchObject({ label: 'End of Oct 2026', kind: 'month-end', asOf: '2026-10' });
    expect(await s.ensureMonthEnd(id, new Date(2026, 10, 25))).toBeNull();
    const next = await s.ensureMonthEnd(id, new Date(2026, 11, 1));
    expect(next?.label).toBe('End of Nov 2026');
    expect(await s.listSnapshots(id)).toHaveLength(2);
  });

  it('freezes the content before the first save of a new month', async () => {
    const { s, id } = await fileFrom(new Date(2026, 9, 20));
    const meta = (await s.load(id))!.meta;
    const changed = starterWorkbook();
    changed.sheets[0].name = 'Changed in November';
    await s.save(id, changed, meta.rev);
    const [snap] = await s.listSnapshots(id);
    expect((await s.loadSnapshot(id, snap.id))?.wb.sheets[0].name).toBe('Operating');
    expect((await s.load(id))?.wb.sheets[0].name).toBe('Changed in November');
  });
});

describe('export files', () => {
  it('round-trips a file with its snapshots', async () => {
    const s = new LocalFileStore(memKV());
    const f = await s.create('Plan');
    await s.takeSnapshot(f.id, 'v1');
    const data = fromExport(roundTrip(await buildExport(s, f.id)), 'x');
    expect(data?.name).toBe('Plan');
    expect(data?.snapshots.map((x) => x.meta.label)).toEqual(['v1']);
    const copy = await s.create('Plan (copy)', data!.wb, data!.snapshots);
    expect(await s.listSnapshots(copy.id)).toHaveLength(1);
  });

  it('accepts earlier formats', () => {
    const wb = starterWorkbook();
    const v1 = { format: 'cashflow-allseeing', version: 1, name: 'Old', exportedAt: '2026-11-07T00:00:00Z', workbook: wb };
    expect(fromExport(roundTrip(v1), 'x')).toMatchObject({ name: 'Old', snapshots: [] });
    expect(fromExport(roundTrip(wb), 'bare')?.name).toBe('bare');
    expect(fromExport({ hello: 1 }, 'x')).toBeNull();
  });

  it('names imports so they differ from the original', () => {
    expect(importedName('Plan', ['Other'])).toBe('Plan');
    expect(importedName('Plan', ['Plan'], '2026-11-07')).toBe('Plan (copy 2026-11-07)');
    expect(importedName('Plan', ['Plan', 'Plan (copy)'])).toBe('Plan (copy) 2');
  });

  it('builds a safe dated file name', () => {
    expect(exportFilename('A/B: plan', new Date(2026, 10, 7))).toBe('A-B- plan 2026-11-07.json');
  });
});
