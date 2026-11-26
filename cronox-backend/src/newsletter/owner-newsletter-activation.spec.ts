import { activationPlanHash, activateOwnerNewsletter, validateActivationPlan, OwnerActivationPlan } from './owner-newsletter-activation';
import { preferenceKey } from './newsletter-preference';

const plan = (): OwnerActivationPlan => ({ version: 1, runId: 'owner-nl-test-existing-cohort', capturedAt: '2026-11-26T08:00:00.000Z', cohort: [{ id: 1, identityUid: 'identity-1', emailKey: preferenceKey('fixture@example.test'), createdAt: '2026-01-01T00:00:00.000Z', initiallySubscribed: false }] });
describe('owner newsletter activation capabilities', () => {
  it('accepts a frozen cohort and fingerprints its previous preference', () => {
    const p = plan(); expect(() => validateActivationPlan(p)).not.toThrow();
    expect(activationPlanHash(p)).not.toBe(activationPlanHash({ ...p, cohort: [{ ...p.cohort[0], initiallySubscribed: true }] }));
  });
  it.each(['empty', 'duplicate-id', 'duplicate-email', 'wrong-run', 'omitted-preference'])('rejects an invalid scope: %s', reason => {
    const p: any = plan();
    if (reason === 'empty') p.cohort = [];
    if (reason === 'duplicate-id') p.cohort.push({ ...p.cohort[0], emailKey: preferenceKey('other@example.test') });
    if (reason === 'duplicate-email') p.cohort.push({ ...p.cohort[0], id: 2 });
    if (reason === 'wrong-run') p.runId = '../arbitrary';
    if (reason === 'omitted-preference') delete p.cohort[0].initiallySubscribed;
    expect(() => validateActivationPlan(p)).toThrow();
  });
  it('a completed batch returns before reading or mutating later withdrawals', async () => {
    const p = plan(), metadata = { planHash: activationPlanHash(p), updated: 1 };
    const tx: any = { $executeRaw: jest.fn(), auditLog: { findUnique: jest.fn(async () => ({ metadata })) } };
    const backup = jest.fn();
    await expect(activateOwnerNewsletter({ $transaction: (fn: any) => fn(tx) } as any, p, backup)).resolves.toMatchObject({ alreadyApplied: true, updated: 0 });
    expect(backup).not.toHaveBeenCalled(); expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('rejects reusing the batch identifier with another cohort', async () => {
    const tx: any = { $executeRaw: jest.fn(), auditLog: { findUnique: jest.fn(async () => ({ metadata: { planHash: 'different' } })) } };
    await expect(activateOwnerNewsletter({ $transaction: (fn: any) => fn(tx) } as any, plan(), jest.fn())).rejects.toThrow('PLAN_CHANGED');
  });
  it('blocks a scheduled campaign before taking a backup or performing account writes', async () => {
    const tx: any = { $executeRaw: jest.fn(), auditLog: { findUnique: jest.fn(async () => null) }, mailboxCampaign: { findMany: jest.fn(async () => [{ status: 'SCHEDULED' }]) } };
    const backup = jest.fn();
    await expect(activateOwnerNewsletter({ $transaction: (fn: any) => fn(tx) } as any, plan(), backup)).rejects.toThrow('SCHEDULE_REVIEW_REQUIRED');
    expect(backup).not.toHaveBeenCalled();
  });
});
