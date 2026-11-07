import { describe, expect, it } from 'vitest';
import { addMonths, groupByYear, monthRange, visibleWindow } from '../src/lib/months';

describe('months', () => {
  it('adds months across year boundaries', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-05', -24)).toBe('2024-05');
  });

  it('window runs from this month to December next year', () => {
    const w = visibleWindow(new Date(2026, 10, 6));
    expect(w[0]).toBe('2026-11');
    expect(w[w.length - 1]).toBe('2027-12');
    expect(w).toHaveLength(14);
    expect(visibleWindow(new Date(2027, 0, 1))).toHaveLength(24);
  });

  it('groups months by year for the header', () => {
    expect(groupByYear(monthRange('2026-11', '2027-12'))).toEqual([
      { year: 2026, count: 2 },
      { year: 2027, count: 12 },
    ]);
  });
});
