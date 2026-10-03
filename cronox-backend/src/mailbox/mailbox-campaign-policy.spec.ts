import {
  assertResolved,
  campaignPolicy,
  canonicalRecipient,
  circles,
  madridInstant,
} from './mailbox-campaign-policy';
describe('Campaign consent and Madrid scheduling boundaries', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  it('uses Madrid summer and winter offsets independently of machine time', () => {
    expect(
      madridInstant('2026-07-01T12:00', undefined, now).toISOString(),
    ).toBe('2026-07-01T10:00:00.000Z');
    expect(
      madridInstant('2026-12-01T12:00', undefined, now).toISOString(),
    ).toBe('2026-12-01T11:00:00.000Z');
  });
  it('rejects spring gaps, malformed calendar dates and past dates', () => {
    for (const local of [
      '2026-03-29T02:30',
      '2026-02-30T12:00',
      '2025-12-31T12:00',
      '2026-01-01T25:00',
      'bad',
    ])
      expect(() => madridInstant(local, undefined, now)).toThrow();
  });
  it('requires choosing the autumn repeated hour and validates its offset', () => {
    expect(() => madridInstant('2026-10-25T02:30', undefined, now)).toThrow(
      'MAILBOX_MADRID_TIME_AMBIGUOUS',
    );
    expect(madridInstant('2026-10-25T02:30', '+02:00', now).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(madridInstant('2026-10-25T02:30', '+01:00', now).toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    );
    expect(() => madridInstant('2026-12-01T12:00', '+02:00', now)).toThrow();
  });
  it('accepts only real circle levels and removes repeated selections', () => {
    expect(circles([3, 1, 3, 5])).toEqual([1, 3, 5]);
    for (const input of [[0], [6], ['1'], [1.5], null])
      expect(() => circles(input)).toThrow();
  });
  it('canonicalizes a single ASCII recipient and excludes malformed or compound entries', () => {
    expect(canonicalRecipient('Test@Example.test')).toBe('test@example.test');
    for (const value of [
      'a@example.test,b@example.test',
      'bad',
      'a@example.test\nBcc: x@example.test',
    ])
      expect(canonicalRecipient(value)).toBeNull();
  });
  it('blocks unresolved placeholders in each effective MIME representation', () => {
    expect(() =>
      assertResolved('Subject', 'plain', '<p>{{actionUrl}}</p>'),
    ).toThrow();
    expect(() =>
      assertResolved('Subject', 'plain', '<p>complete</p>'),
    ).not.toThrow();
  });
  it('does not enable campaigns merely because existing mailbox sending is enabled', () => {
    const original = process.env.MAILBOX_CAMPAIGN_ENABLED;
    process.env.MAILBOX_CAMPAIGN_ENABLED = 'false';
    try {
      expect(campaignPolicy().ready).toBe(false);
    } finally {
      if (original === undefined) delete process.env.MAILBOX_CAMPAIGN_ENABLED;
      else process.env.MAILBOX_CAMPAIGN_ENABLED = original;
    }
  });
});
