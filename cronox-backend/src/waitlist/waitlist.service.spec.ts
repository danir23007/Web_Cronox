import { WaitlistService, waitlistWorkerEnabled } from './waitlist.service';
import { RestockDeliveryError } from '../email/restock-delivery.error';

describe('Waitlist dispatch safeguards', () => {
  const fixture = () => {
    const row = {
      id: 'r',
      claimToken: 'claim',
      status: 'PROCESSING',
      attempts: 1,
      user: { email: 'buyer@example.test', accountState: 'ACTIVE' },
      variant: {
        stockQty: 1,
        isActive: true,
        size: 'US_8',
        product: { isActive: true, slug: 'ring', name: 'Ring', images: [] },
      },
    };
    const prisma = {
      keyScreenSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      restockRequest: {
        findFirst: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const mail = {
      isRestockSenderConfigured: jest.fn().mockReturnValue(true),
      sendRestock: jest.fn().mockResolvedValue(undefined),
    };
    return {
      row,
      prisma,
      mail,
      service: new WaitlistService(prisma as any, mail as any),
    };
  };
  it.each(['stock', 'variant', 'product'])(
    'rechecks %s before SMTP and retains unfulfilled request',
    async (kind) => {
      const h = fixture();
      if (kind === 'stock') h.row.variant.stockQty = 0;
      if (kind === 'variant') h.row.variant.isActive = false;
      if (kind === 'product') h.row.variant.product.isActive = false;
      await h.service.dispatch('r', 'claim');
      expect(h.mail.sendRestock).not.toHaveBeenCalled();
      expect(h.prisma.restockRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'WAITING' }),
        }),
      );
    },
  );
  it.each(['bad-email', 'inactive', 'deleted'])(
    'does not send to %s customer',
    async (kind) => {
      const h = fixture();
      if (kind === 'bad-email') h.row.user.email = 'not-an-email';
      if (kind === 'inactive') h.row.user.accountState = 'PRE_REGISTERED';
      if (kind === 'deleted')
        h.prisma.restockRequest.findFirst.mockResolvedValue(null);
      await h.service.dispatch('r', 'claim');
      expect(h.mail.sendRestock).not.toHaveBeenCalled();
    },
  );
  it('disabled configuration between claim and dispatch does not consume an attempt', async () => {
    const h = fixture();
    h.mail.isRestockSenderConfigured.mockReturnValue(false);
    await h.service.dispatch('r', 'claim');
    expect(h.mail.sendRestock).not.toHaveBeenCalled();
    expect(h.prisma.restockRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'QUEUED',
          attempts: { decrement: 1 },
        }),
      }),
    );
  });
  it('SMTP acceptance followed by database failure never enters safe-retry branch', async () => {
    const h = fixture();
    h.prisma.restockRequest.updateMany.mockRejectedValue(
      new Error('database down'),
    );
    await expect(h.service.dispatch('r', 'claim')).rejects.toThrow(
      'database down',
    );
    expect(h.mail.sendRestock).toHaveBeenCalledTimes(1);
    expect(h.prisma.restockRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(
      h.prisma.restockRequest.updateMany.mock.calls[0][0].data.status,
    ).toBe('ACCEPTED');
  });
  it('a closed storefront pauses dispatch without consuming an attempt', async () => {
    const h = fixture();
    h.prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      expiresAt: null,
    });
    await h.service.dispatch('r', 'claim');
    expect(h.mail.sendRestock).not.toHaveBeenCalled();
    expect(
      h.prisma.restockRequest.updateMany.mock.calls[0][0].data.status,
    ).toBe('QUEUED');
  });
  it.each([
    ['RETRY', 1, 'QUEUED'],
    ['RETRY', 3, 'FAILED'],
    ['FAILED', 1, 'FAILED'],
    ['UNCERTAIN', 1, 'UNCERTAIN'],
  ])('handles %s on attempt %s as %s', async (outcome, attempts, expected) => {
    const h = fixture();
    h.row.attempts = Number(attempts);
    h.mail.sendRestock.mockRejectedValue(
      new RestockDeliveryError(outcome as any),
    );
    await h.service.dispatch('r', 'claim');
    expect(
      h.prisma.restockRequest.updateMany.mock.calls[0][0].data.status,
    ).toBe(expected);
  });
  describe('production startup (fake clock, database and sender)', () => {
    let previous: NodeJS.ProcessEnv;
    beforeEach(() => {
      previous = { ...process.env };
      process.env.NODE_ENV = 'production';
      delete process.env.WAITLIST_EMAIL_WORKER_ENABLED;
      delete process.env.CRONOX_ROUTE_SMOKE_MODE;
      jest.useFakeTimers();
    });
    afterEach(() => {
      process.env = previous;
      jest.useRealTimers();
    });

    it.each([undefined, 'true'])(
      'automatically processes an eligible notice after startup with setting %s',
      async (value) => {
        if (value !== undefined)
          process.env.WAITLIST_EMAIL_WORKER_ENABLED = value;
        const h = fixture();
        const prisma = h.prisma as any;
        prisma.$queryRaw = jest
          .fn()
          .mockResolvedValueOnce([{ id: 'r' }])
          .mockResolvedValue([]);
        // A fake public origin: no request is made to this address.
        process.env.FRONTEND_URL = 'https://store.example.test';
        try {
          expect(waitlistWorkerEnabled()).toBe(true);
          h.service.onModuleInit();
          expect(h.mail.sendRestock).not.toHaveBeenCalled();
          await jest.advanceTimersByTimeAsync(10000);
          expect(h.mail.sendRestock).toHaveBeenCalledTimes(1);
          expect(prisma.restockRequest.updateMany).toHaveBeenLastCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ status: 'ACCEPTED' }),
            }),
          );
          await jest.advanceTimersByTimeAsync(10000);
          expect(h.mail.sendRestock).toHaveBeenCalledTimes(1);
        } finally {
          h.service.onModuleDestroy();
        }
        expect(jest.getTimerCount()).toBe(0);
      },
    );

    it.each(['false', ' FALSE ', '', 'invalid'])(
      'explicit disabled/invalid setting %j never starts or processes',
      async (value) => {
        process.env.WAITLIST_EMAIL_WORKER_ENABLED = value;
        const h = fixture();
        expect(waitlistWorkerEnabled()).toBe(false);
        h.service.onModuleInit();
        await h.service.tick();
        await jest.advanceTimersByTimeAsync(20000);
        expect(jest.getTimerCount()).toBe(0);
        expect(h.prisma.restockRequest.updateMany).not.toHaveBeenCalled();
        expect(h.mail.sendRestock).not.toHaveBeenCalled();
      },
    );

    it('still suppresses the worker during compiled route smoke tests', async () => {
      process.env.CRONOX_ROUTE_SMOKE_MODE = 'true';
      const h = fixture();
      h.service.onModuleInit();
      await h.service.tick();
      expect(waitlistWorkerEnabled()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      expect(h.prisma.restockRequest.updateMany).not.toHaveBeenCalled();
    });

    it.each(['mail', 'gate'])(
      'default startup does not send when %s is unavailable',
      async (blocker) => {
        const h = fixture();
        if (blocker === 'mail')
          h.mail.isRestockSenderConfigured.mockReturnValue(false);
        else
          h.prisma.keyScreenSettings.findUnique.mockResolvedValue({
            enabled: true,
            expiresAt: null,
          });
        try {
          h.service.onModuleInit();
          await jest.advanceTimersByTimeAsync(10000);
          expect(jest.getTimerCount()).toBe(1);
          expect(h.mail.sendRestock).not.toHaveBeenCalled();
        } finally {
          h.service.onModuleDestroy();
        }
      },
    );
  });
});
