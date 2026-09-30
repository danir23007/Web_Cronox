import { NewsletterService } from './newsletter.service';

describe('Newsletter durable single opt-in', () => {
  let row: any, promo: any, user: any, jobs: any[], db: any, mail: any, service: NewsletterService;
  beforeEach(() => {
    row = null; promo = null; user = null; jobs = [];
    db = {
      $executeRaw: jest.fn(),
      newsletterSubscription: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(async ({ create }: any) => { row ||= { id: 'sub', ...create, verifiedAt: null }; return { ...row, welcomePromoCode: promo }; }),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
      },
      newsletterMailJob: {
        findFirst: jest.fn(async ({ where }: any) => jobs.find(job => job.email === where.email && job.kind === where.kind && (!where.createdAt || job.createdAt >= where.createdAt.gte)) || null),
        create: jest.fn(async ({ data }: any) => { const job = { id: `job-${jobs.length}`, createdAt: new Date(), ...data }; jobs.push(job); return job; }),
      },
      user: { findMany: jest.fn(async () => user ? [user] : []), findUnique: jest.fn(async () => user), update: jest.fn(async ({ data }: any) => Object.assign(user, data)), create: jest.fn() },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      discountCode: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      promoCode: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(async ({ create }: any) => {
        promo = { id: 1, isActive: true, usageCount: 0, ...create }; return promo;
      }) },
    };
    db.$transaction = jest.fn(async (fn: any) => fn(db));
    mail = { sendNewsletterWelcome: jest.fn() };
    service = new NewsletterService(db, mail);
  });

  it('persists consent, one welcome benefit and one durable job before returning 202', async () => {
    expect(await service.subscribe('NEW@example.test')).toEqual({ status: 'accepted', httpStatus: 202, confirmation: 'welcome' });
    expect(row.email).toBe('new@example.test');
    expect(row.subscribedAt).toBeInstanceOf(Date);
    expect(row.verifiedAt).toBeNull();
    expect(promo.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(promo).toMatchObject({ type: 'PERCENT', value: 10, firstOrderOnly: true, ownerEmail: 'new@example.test', usageLimit: 1 });
    expect(jobs).toMatchObject([{ email: 'new@example.test', kind: 'WELCOME' }]);
    expect(mail.sendNewsletterWelcome).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('keeps the public response identical and never duplicates a pending welcome', async () => {
    const first = await service.subscribe('new@example.test');
    const repeated = await service.subscribe('NEW@example.test');
    expect(first.confirmation).toBe('welcome');
    expect(repeated.confirmation).toBe('subscribed');
    expect(jobs).toHaveLength(1);
    expect(db.promoCode.upsert).toHaveBeenCalledTimes(1);
  });

  it('queues one access message for an existing subscriber, with or without an account', async () => {
    row = { id: 'sub', email: 'known@example.test', subscribedAt: new Date(), welcomeSentAt: new Date() };
    const first = await service.subscribe('known@example.test');
    user = { id: 7, email: row.email, newsletterSubscribed: true, role: 'USER', accountState: 'ACTIVE' };
    const second = await service.subscribe('KNOWN@example.test');
    expect(first.confirmation).toBe('subscribed');
    expect(second.confirmation).toBe('existing_account');
    expect(jobs).toMatchObject([{ email: row.email, kind: 'ACCESS' }]);
    expect(db.promoCode.upsert).not.toHaveBeenCalled();
  });

  it('does not report accepted when durable scheduling fails', async () => {
    db.newsletterMailJob.create.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.subscribe('new@example.test')).rejects.toThrow('database unavailable');
    expect(mail.sendNewsletterWelcome).not.toHaveBeenCalled();
  });

  it('uses account records before a first subscription and preserves its one welcome benefit', async () => {
    user = { id: 7, email: 'known@example.test', role: 'USER', accountState: 'ACTIVE', newsletterSubscribed: false };
    expect((await service.subscribe(user.email)).confirmation).toBe('existing_account');
    expect(jobs.map(job => job.kind)).toEqual(['ACCESS', 'WELCOME']);
    await service.subscribe(user.email);
    expect(jobs).toHaveLength(2);
    expect(db.promoCode.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(['ADMIN', 'SUPERADMIN'])('does not advertise passwordless access for %s', async role => {
    user = { id: 7, email: 'known@example.test', role, accountState: 'ACTIVE' };
    row = { id: 'sub', email: user.email, subscribedAt: new Date(), welcomeSentAt: new Date() };
    expect((await service.subscribe(user.email)).confirmation).toBe('subscribed');
  });

  it('only offers replacement access for existing consent and respects the cooldown', async () => {
    expect(await service.requestAccess('unknown@example.test')).toEqual({ status: 'accepted', httpStatus: 202 });
    expect(jobs).toHaveLength(0);
    row = { id: 'sub', email: 'known@example.test', subscribedAt: new Date() };
    await service.requestAccess(row.email);
    await service.requestAccess(row.email);
    expect(jobs).toHaveLength(1);
  });

  it('inherits consent on account creation without another welcome or code', async () => {
    await service.subscribe('new@example.test');
    user = { id: 1, newsletterSubscribed: false };
    expect(await service.subscribeIfNeeded('new@example.test')).toEqual({ status: 'claimed' });
    expect(user.newsletterSubscribed).toBe(true);
    expect(db.user.update.mock.calls[0][0].data).toEqual({ newsletterSubscribed: true });
  });

  it('does not enroll someone just because they register an account', async () => {
    user = { id: 1 };
    expect(await service.subscribeIfNeeded('new@example.test')).toEqual({ status: 'not_subscribed' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('preserves legacy welcome codes and avoids benefits for previous buyers', async () => {
    user = { id: 1, newsletterSubscribed: false };
    db.discountCode.findFirst.mockResolvedValue({ code: 'CRX10-ABC234', used: false });
    await service.subscribe('new@example.test');
    expect(promo.code).toBe('CRX10-ABC234');
    row = null; promo = null; jobs = [];
    db.order.findFirst.mockResolvedValue({ id: 2 });
    await service.subscribe('buyer@example.test');
    expect(jobs).toMatchObject([{ email: 'buyer@example.test', kind: 'WELCOME' }]);
    expect(db.promoCode.upsert).toHaveBeenCalledTimes(1);
  });
});
