import { archiveUtcDate, configuredManualCost } from './historical-cost';

describe('historical cost evidence', () => {
  it.each([0, 1500])('accepts configured manual cost %i regardless of update date', unitCostCents => {
    expect(configuredManualCost({ unitCostCents })).toBe(unitCostCents);
  });
  it('keeps missing and invalid costs unknown instead of converting them to zero', () => {
    expect(configuredManualCost({ unitCostCents: null })).toBeNull();
    expect(configuredManualCost(null)).toBeNull();
    expect(configuredManualCost({ unitCostCents: -1 })).toBeNull();
    expect(configuredManualCost({ unitCostCents: 1.5 })).toBeNull();
  });
  it('hydrates suffix-free database timestamps as UTC independently of the server locale', () => {
    expect(archiveUtcDate('2026-09-23T02:28:00').toISOString()).toBe('2026-09-23T02:28:00.000Z');
    expect(archiveUtcDate('2026-09-23T04:28:00+02:00').toISOString()).toBe('2026-09-23T02:28:00.000Z');
  });
});
