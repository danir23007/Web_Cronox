import { NewsletterService } from './newsletter.service';

describe('Newsletter single opt-in', () => {
  let row: any, promo: any, user: any, db: any, mail: any, service: NewsletterService;
  beforeEach(() => {
    row = null; promo = null; user = null;
    db = {
      $executeRaw: jest.fn(),
      newsletterSubscription: {
        upsert: jest.fn(async ({ create }: any) => { row ||= { id: 'sub', ...create, verifiedAt: null }; return { ...row, welcomePromoCode: promo }; }),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
        updateMany: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
        findUnique: jest.fn(async () => row),
      },
      user: { findUnique: jest.fn(async () => user), update: jest.fn(async ({ data }: any) => Object.assign(user, data)), create: jest.fn() },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      discountCode: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      promoCode: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(async ({ create }: any) => {
        promo = { id: 1, isActive: true, usageCount: 0, ...create }; return promo;
      }) },
    };
    db.$transaction = jest.fn(async (fn: any) => fn(db));
    mail = { sendNewsletterWelcome: jest.fn().mockResolvedValue({ messageId: 'test' }) };
    service = new NewsletterService(db, mail);
  });
  it('subscribes a guest immediately and mails one six-character usable code without verifying identity', async () => {
    expect(await service.subscribe('NEW@example.test')).toEqual({ status: 'accepted', httpStatus: 202 });
    expect(row.email).toBe('new@example.test');
    expect(row.subscribedAt).toBeInstanceOf(Date);
    expect(row.verifiedAt).toBeNull();
    expect(row.verificationTokenHash).toBeUndefined();
    expect(row.welcomeSentAt).toBeInstanceOf(Date);
    expect(promo.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(promo).toMatchObject({ type: 'PERCENT', value: 10, firstOrderOnly: true, ownerEmail: 'new@example.test', usageLimit: 1 });
    expect(mail.sendNewsletterWelcome).toHaveBeenCalledWith('new@example.test', promo.code);
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it('does not send another email or allocate another code on duplicate submissions', async () => {
    await service.subscribe('new@example.test'); await service.subscribe('NEW@example.test');
    expect(mail.sendNewsletterWelcome).toHaveBeenCalledTimes(1);
    expect(db.promoCode.upsert).toHaveBeenCalledTimes(1);
  });
  it('preserves subscription and code on failure and retries without duplicates', async () => {
    mail.sendNewsletterWelcome.mockRejectedValueOnce(new Error('disabled SMTP'));
    await expect(service.subscribe('new@example.test')).rejects.toMatchObject({ status: 503 });
    const code = promo.code;
    expect(row.subscribedAt).toBeInstanceOf(Date); expect(row.welcomeSentAt).toBeUndefined();
    expect(row.welcomeClaimedAt).toBeNull();
    await service.subscribe('new@example.test');
    expect(promo.code).toBe(code); expect(db.promoCode.upsert).toHaveBeenCalledTimes(1);
  });
  it('does not automatically resend after an uncertain SMTP outcome', async () => {
    mail.sendNewsletterWelcome.mockRejectedValueOnce(Object.assign(new Error('timeout'), { deliveryUnknown: true }));
    await expect(service.subscribe('new@example.test')).rejects.toMatchObject({ status: 503 });
    await expect(service.subscribe('new@example.test')).rejects.toMatchObject({ status: 503 });
    expect(mail.sendNewsletterWelcome).toHaveBeenCalledTimes(1);
  });
  it('inherits consent on account creation without a second welcome or code', async () => {
    await service.subscribe('new@example.test');
    user = { id: 1, newsletterSubscribed: false };
    expect(await service.subscribeIfNeeded('new@example.test')).toEqual({ status: 'claimed' });
    expect(user.newsletterSubscribed).toBe(true);
    expect(mail.sendNewsletterWelcome).toHaveBeenCalledTimes(1);
    expect(db.user.update.mock.calls[0][0].data).toEqual({ newsletterSubscribed: true });
  });
  it('does not enroll someone just because they register an account', async () => {
    user = { id: 1 };
    expect(await service.subscribeIfNeeded('new@example.test')).toEqual({ status: 'not_subscribed' });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('preserves already-issued legacy codes', async () => {
    user = { id: 1, newsletterSubscribed: false };
    db.discountCode.findFirst.mockResolvedValue({ code: 'CRX10-ABC234', used: false });
    await service.subscribe('new@example.test');
    expect(mail.sendNewsletterWelcome).toHaveBeenCalledWith('new@example.test', 'CRX10-ABC234');
  });
  it('does not issue another first-purchase benefit to a previous buyer', async () => {
    user = { id: 1 }; db.order.findFirst.mockResolvedValue({ id: 2 });
    await service.subscribe('new@example.test');
    expect(db.promoCode.upsert).not.toHaveBeenCalled();
    expect(mail.sendNewsletterWelcome).toHaveBeenCalledWith('new@example.test', undefined);
  });
});
