import { receiptDate, receiptDay } from './receipt-date';

describe('receipt calendar dates', () => {
  it.each(['2026-03-29', '2026-10-25', '2024-02-29'])('round trips %s at UTC midnight', day => {
    expect(receiptDate(day)?.toISOString()).toBe(day + 'T00:00:00.000Z');
    expect(receiptDay(receiptDate(day))).toBe(day);
  });
  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '2026-3-1', '2026-03-29T00:00:00Z', ''])('rejects invalid calendar day %s', day => {
    expect(() => receiptDate(day)).toThrow();
  });
  it('distinguishes omitted dates from an explicit clear', () => {
    expect(receiptDate(undefined)).toBeUndefined();
    expect(receiptDate(null)).toBeNull();
    expect(receiptDay(null)).toBeNull();
  });
});
