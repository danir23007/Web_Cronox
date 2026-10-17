import { StripeWebhookRecoveryService } from './stripe-webhook-recovery.service';
import { ConflictException } from '@nestjs/common';

describe('Stripe recovery operational boundaries', () => {
  const previous = { smoke: process.env.CRONOX_ROUTE_SMOKE_MODE, worker: process.env.STRIPE_WEBHOOK_WORKER_ENABLED, local: process.env.CRONOX_LOCAL_DEV };
  afterEach(() => {
    jest.useRealTimers();
    for (const [key, value] of Object.entries({ CRONOX_ROUTE_SMOKE_MODE: previous.smoke, STRIPE_WEBHOOK_WORKER_ENABLED: previous.worker, CRONOX_LOCAL_DEV: previous.local })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('leaves imported local review data untouched even when optional jobs settings differ', () => {
    process.env.CRONOX_LOCAL_DEV = 'true';
    process.env.CRONOX_ROUTE_SMOKE_MODE = 'false';
    delete process.env.STRIPE_WEBHOOK_WORKER_ENABLED;
    jest.useFakeTimers();
    const service = new StripeWebhookRecoveryService({} as any);
    const tick = jest.spyOn(service, 'tick');
    service.onModuleInit();
    expect(tick).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start timers or read a non-migrated database in route smoke mode', () => {
    process.env.CRONOX_ROUTE_SMOKE_MODE = 'true';
    jest.useFakeTimers();
    const service = new StripeWebhookRecoveryService({} as any);
    const tick = jest.spyOn(service, 'tick');
    service.onModuleInit();
    expect(tick).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('requires acknowledgement before requeueing uncertain external delivery and writes no audit on rejected CAS', async () => {
    const tx = { checkoutEffect: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, auditLog: { create: jest.fn() } };
    const service = new StripeWebhookRecoveryService({ $transaction: (fn: any) => fn(tx) } as any);
    await expect(service.retry('effect', 'effect1', 12)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.checkoutEffect.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'effect1', status: 'REVIEW', kind: 'ANALYTICS' } }));
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('records the actor and explicit uncertainty acknowledgement in the same retry transaction', async () => {
    const tx = { checkoutEffect: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: jest.fn() } };
    const service = new StripeWebhookRecoveryService({ $transaction: (fn: any) => fn(tx) } as any);
    await expect(service.retry('effect', 'effect1', 12, true)).resolves.toEqual({ queued: true });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 12, targetId: 'effect1', metadata: { acknowledgeUncertainDelivery: true } }) });
  });

  it('lists incident metadata without returning signed payloads or customer details', async () => {
    const prisma = { stripeWebhookEvent: { findMany: jest.fn().mockResolvedValue([]) }, checkoutEffect: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new StripeWebhookRecoveryService(prisma as any);
    await service.incidents();
    expect(prisma.stripeWebhookEvent.findMany.mock.calls[0][0].select).not.toHaveProperty('payload');
    expect(prisma.checkoutEffect.findMany.mock.calls[0][0].select).not.toHaveProperty('userId');
  });

  it('does not recreate work for an archived deleted test payment', async () => {
    const prisma = { archivedCheckoutPayment: { findUnique: jest.fn().mockResolvedValue({ paymentIntentId: 'pi_archived' }) }, stripeWebhookEvent: { createMany: jest.fn() } };
    const service = new StripeWebhookRecoveryService(prisma as any);
    await expect(service.accept({ id: 'evt_archive' } as any, { paymentIntentId: 'pi_archived' })).resolves.toEqual({ received: true, duplicate: true, archived: true });
    expect(prisma.stripeWebhookEvent.createMany).not.toHaveBeenCalled();
  });

  it('reports automatic startup, scan failure and recovery without exposing error contents', async () => {
    process.env.CRONOX_LOCAL_DEV = 'false';
    process.env.CRONOX_ROUTE_SMOKE_MODE = 'false';
    process.env.STRIPE_WEBHOOK_WORKER_ENABLED = 'true';
    jest.useFakeTimers();
    const prisma = {
      stripeWebhookEvent: { findMany: jest.fn().mockResolvedValue([]) },
      checkoutEffect: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new StripeWebhookRecoveryService(prisma as any);
    service.register(async () => ({}), async () => 'not_needed');
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1);
    expect((await service.incidents()).worker).toMatchObject({ enabled: true, disabledReason: null, lastScanCompletedAt: expect.any(Date) });
    prisma.stripeWebhookEvent.findMany.mockRejectedValueOnce(new Error('private connection information'));
    await jest.advanceTimersByTimeAsync(5000);
    const failed = (await service.incidents()).worker;
    expect(failed.lastScanError).toBe('RECOVERY_SCAN_FAILED');
    expect(JSON.stringify(failed)).not.toContain('private');
    await jest.advanceTimersByTimeAsync(5000);
    expect((await service.incidents()).worker.lastScanError).toBeNull();
    service.onModuleDestroy();
    expect((await service.incidents()).worker).toMatchObject({ enabled: false, disabledReason: 'STOPPED' });
    expect(jest.getTimerCount()).toBe(0);
  });
});
