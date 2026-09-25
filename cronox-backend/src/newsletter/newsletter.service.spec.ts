import { createHash } from 'crypto';
import { NewsletterService } from './newsletter.service';

describe('NewsletterService verification flow', () => {
  const originalEnvironment = { ...process.env };
  let tx: any;
  let prisma: any;
  let emailService: any;
  let service: NewsletterService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.API_PUBLIC_URL = 'http://localhost:3000';

    tx = {
      newsletterSubscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      discountCode: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
      newsletterSubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    emailService = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendNewsletterConfirmation: jest
        .fn()
        .mockResolvedValue({ messageId: 'message-id' }),
      sendFirstOrderDiscount: jest.fn(),
    };
    service = new NewsletterService(prisma, emailService);
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
  });

  it('creates a standalone pending subscription rather than preempting a User account', async () => {
    await expect(service.subscribe('NEW@example.test')).resolves.toEqual({
      status: 'accepted',
      httpStatus: 202,
    });

    const storedHash =
      tx.newsletterSubscription.create.mock.calls[0][0].data
        .verificationTokenHash;
    const verificationUrl =
      emailService.sendNewsletterConfirmation.mock.calls[0][1];
    const rawToken = new URL(verificationUrl).searchParams.get('token');

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(storedHash).toBe(
      createHash('sha256')
        .update(rawToken as string)
        .digest('hex'),
    );
    expect(storedHash).not.toBe(rawToken);
  });

  it('preserves an unverified attempt and returns 503 while delivery is disabled', async () => {
    emailService.isEnabled.mockReturnValue(false);

    await expect(service.subscribe('new@example.test')).rejects.toMatchObject({ status: 503 });

    expect(tx.newsletterSubscription.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(emailService.sendNewsletterConfirmation).not.toHaveBeenCalled();
  });

  it('keeps a usable pending token on SMTP failure and retries the same row', async () => {
    emailService.sendNewsletterConfirmation.mockRejectedValueOnce(new Error('SMTP failure'));
    await expect(service.subscribe('new@example.test')).rejects.toMatchObject({ status: 503 });
    const data = tx.newsletterSubscription.create.mock.calls[0][0].data;
    expect(prisma.newsletterSubscription.updateMany).not.toHaveBeenCalled();
    tx.newsletterSubscription.findUnique.mockResolvedValue({ id: 'subscription-1', ...data, verifiedAt: null });
    await expect(service.subscribe('NEW@example.test')).resolves.toEqual({ status: 'accepted', httpStatus: 202 });
    expect(tx.newsletterSubscription.create).toHaveBeenCalledTimes(1);
    expect(tx.newsletterSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'subscription-1', verifiedAt: null }),
    }));
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.discountCode.create).not.toHaveBeenCalled();
  });

  it.each([true, false])('does not expose already-verified state when SMTP enabled=%s', async enabled => {
    const verifiedAt = new Date();
    tx.newsletterSubscription.findUnique.mockResolvedValue({ id: 'subscription-1', verifiedAt, verificationTokenHash: null });
    emailService.isEnabled.mockReturnValue(enabled);
    if (enabled) await expect(service.subscribe('known@example.test')).resolves.toMatchObject({ status: 'accepted' });
    else await expect(service.subscribe('known@example.test')).rejects.toMatchObject({ status: 503 });
    expect(tx.newsletterSubscription.updateMany.mock.calls[0][0].data).not.toHaveProperty('verifiedAt');
    expect(tx.discountCode.create).not.toHaveBeenCalled();
    expect(emailService.sendNewsletterConfirmation).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it('returns a retryable failure if confirmation or another request won the token update race', async () => {
    tx.newsletterSubscription.findUnique.mockResolvedValue({ id: 'subscription-1', verifiedAt: null, verificationTokenHash: 'old' });
    tx.newsletterSubscription.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.subscribe('new@example.test')).rejects.toMatchObject({ status: 503 });
    expect(emailService.sendNewsletterConfirmation).not.toHaveBeenCalled();
  });

  it.each([undefined, 'invalid', 'x'.repeat(513)])('rejects malformed tokens without accessing the database', async token => {
    expect(await service.confirm(token)).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not confirm expired, consumed or unknown tokens and grants no benefits', async () => {
    expect(await service.confirm('x'.repeat(43))).toBe(false);
    tx.newsletterSubscription.findUnique.mockResolvedValue({ id: 'subscription-1', verificationExpiresAt: new Date(0), verifiedAt: null });
    tx.newsletterSubscription.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.confirm('x'.repeat(43))).toBe(false);
    expect(tx.newsletterSubscription.updateMany.mock.calls[0][0].where.verificationExpiresAt.gt).toBeInstanceOf(Date);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.discountCode.create).not.toHaveBeenCalled();
  });

  it('confirms a standalone subscription once without inventing a user or discount', async () => {
    tx.newsletterSubscription.findUnique.mockResolvedValue({ id: 'subscription-1', email: 'new@example.test', verifiedAt: null, verificationExpiresAt: new Date(Date.now() + 86400000) });
    expect(await service.confirm('x'.repeat(43))).toBe(true);
    expect(tx.newsletterSubscription.updateMany.mock.calls[0][0].data).toEqual({ verifiedAt: expect.any(Date), verificationTokenHash: null, verificationExpiresAt: null });
    tx.newsletterSubscription.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.confirm('x'.repeat(43))).toBe(false);
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.discountCode.create).not.toHaveBeenCalled();
  });

  it('grants account benefits only after claiming the valid confirmation', async () => {
    tx.newsletterSubscription.findUnique.mockResolvedValue({ id: 'subscription-1', email: 'new@example.test', verifiedAt: null, verificationExpiresAt: new Date(Date.now() + 86400000) });
    tx.user.findUnique.mockResolvedValue({ id: 1, newsletterSubscribed: false, firstOrderDiscountCode: null, firstOrderDiscountUsed: false });
    expect(await service.confirm('x'.repeat(43))).toBe(true);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ newsletterSubscribed: true }) }));
    expect(tx.discountCode.create).toHaveBeenCalledTimes(1);
  });
});
