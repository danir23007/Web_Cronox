import { NewsletterService } from './newsletter.service';
jest.mock('../users/member-code.util', () => ({ getNextSequentialMemberCode: jest.fn().mockResolvedValue('CRX-000123') }));

describe('Newsletter registration and independent checkout opt-in', () => {
  let row: any, promo: any, legacy: any, user: any, jobs: any[], db: any, mail: any, service: NewsletterService;
  beforeEach(() => {
    row = null; promo = null; legacy = null; user = null; jobs = [];
    db = {
      accountWelcomeBenefit: { create: jest.fn() },
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(async () => user ? [user] : []),
      newsletterSubscription: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(async ({ create }: any) => { row ||= { id: 'sub', ...create, verifiedAt: null }; return { ...row, welcomePromoCode: promo }; }),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
      },
      newsletterMailJob: {
        findFirst: jest.fn(async ({ where }: any) => jobs.find(job => (where.OR ? where.OR.some((match: any) => match.userId ? job.userId === match.userId : job.email === match.email) : job.email === where.email) && job.kind === where.kind && (!where.createdAt || job.createdAt >= where.createdAt.gte)) || null),
        create: jest.fn(async ({ data }: any) => { const job = { id: `job-${jobs.length}`, createdAt: new Date(), ...data }; jobs.push(job); return job; }),
      },
      user: { findFirst: jest.fn(async () => user), findMany: jest.fn(async () => user ? [user] : []), findUnique: jest.fn(async () => user), findUniqueOrThrow: jest.fn(async () => user), update: jest.fn(async ({ data }: any) => Object.assign(user, data)), create: jest.fn(async ({ data }: any) => user = { id: 1, role: 'USER', ...data }) },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      discountCode: { findFirst: jest.fn(async () => legacy), findUnique: jest.fn(async () => legacy), create: jest.fn(async ({ data }: any) => legacy = { ...data }) },
      promoCodeRedemption: { findFirst: jest.fn().mockResolvedValue(null) },
      promoCode: { findFirst: jest.fn(async () => promo), findUnique: jest.fn(async ({ where }: any) => promo?.code === where.code ? promo : null), create: jest.fn(async ({ data }: any) => {
        promo = { id: 1, isActive: true, usageCount: 0, ...data }; return promo;
      }) },
    };
    db.$transaction = jest.fn(async (fn: any) => fn(db));
    mail = { sendNewsletterWelcome: jest.fn() };
    service = new NewsletterService(db, mail);
  });

  it.each(['new', 'subscribed', 'existing'])('starting %s registration makes no writes or delivery', async kind => {
    if (kind === 'subscribed') row = { email: 'new@example.test', subscribedAt: new Date() };
    if (kind === 'existing') user = { id: 7, email: 'new@example.test', newsletterSubscribed: false };
    expect(await service.startRegistration(' NEW@example.test ')).toEqual({ status: kind === 'existing' ? 'authentication_required' : 'registration_required' });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.newsletterSubscription.upsert).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it('completes consent for the authenticated address without another code or message', async () => {
    user = { id: 7, email: 'known@example.test', role: 'USER', accountState: 'ACTIVE', newsletterSubscribed: false, password: 'unchanged' };
    expect(await service.completeRegistration(7, ' KNOWN@example.test ')).toEqual({ status: 'subscribed' });
    await service.completeRegistration(7, user.email);
    expect(row).toMatchObject({ userId: 7, email: user.email });
    expect(user).toMatchObject({ newsletterSubscribed: true, password: 'unchanged' });
    expect(jobs).toHaveLength(0);
    expect(db.promoCode.create).not.toHaveBeenCalled();
  });

  it.each(['different-address', 'blocked', 'link-conflict'])('rejects %s before persisting consent', async reason => {
    user = { id: 7, email: 'known@example.test', role: 'USER', accountState: reason === 'blocked' ? 'DISABLED' : 'ACTIVE' };
    if (reason === 'link-conflict') row = { email: user.email, userId: 8 };
    await expect(service.completeRegistration(7, reason === 'different-address' ? 'other@example.test' : user.email)).rejects.toThrow();
    expect(db.newsletterSubscription.upsert).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('persists consent without creating an incomplete account, code, session or welcome', async () => {
    expect(await service.subscribe(' NEW@example.test ')).toEqual({ status: 'accepted', httpStatus: 202, confirmation: 'subscribed' });
    expect(row.email).toBe('new@example.test');
    expect(row.subscribedAt).toBeInstanceOf(Date);
    expect(row.verifiedAt).toBeNull();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.promoCode.create).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
    expect(mail.sendNewsletterWelcome).not.toHaveBeenCalled();
  });

  it('repeated subscription without an account remains one subscription and no account', async () => {
    await service.subscribe('new@example.test');
    const first = row;
    expect((await service.subscribe('NEW@example.test')).confirmation).toBe('subscribed');
    expect(row).toBe(first);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it('preserves an existing account and limits replacement access to one job per cooldown', async () => {
    user = { id: 7, email: 'known@example.test', role: 'USER', accountState: 'ACTIVE', newsletterSubscribed: false, password: 'unchanged', name: 'Original' };
    expect((await service.subscribe(user.email)).confirmation).toBe('existing_account');
    await service.subscribe(user.email);
    expect(user).toMatchObject({ password: 'unchanged', name: 'Original', newsletterSubscribed: true });
    expect(row.userId).toBe(7);
    expect(jobs.map(job => job.kind)).toEqual(['ACCESS']);
    expect(db.promoCode.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('does not add access delivery beside an existing pending welcome', async () => {
    user = { id: 7, email: 'known@example.test', role: 'USER', accountState: 'ACTIVE' };
    jobs.push({ email: user.email, kind: 'WELCOME' });
    expect((await service.subscribe(user.email)).confirmation).toBe('existing_account');
    expect(jobs).toHaveLength(1);
  });

  it('does not report accepted when persistence fails', async () => {
    db.newsletterSubscription.upsert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.subscribe('new@example.test')).rejects.toThrow('database unavailable');
    expect(mail.sendNewsletterWelcome).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'SUPERADMIN'])('does not send passwordless access or create a new account for %s', async role => {
    user = { id: 7, email: 'known@example.test', role, accountState: 'ACTIVE' };
    expect((await service.subscribe(user.email)).confirmation).toBe('existing_account');
    expect(jobs).toHaveLength(0);
  });

  it('rejects ambiguous account matches without selecting a user', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await expect(service.subscribe('same@example.test')).rejects.toThrow();
    expect(db.user.update).not.toHaveBeenCalled();
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
    user = { id: 1, email: 'new@example.test', newsletterSubscribed: false };
    expect(await service.subscribeIfNeeded('new@example.test')).toEqual({ status: 'claimed' });
    expect(user.newsletterSubscribed).toBe(true);
    expect(db.user.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { newsletterSubscribed: true } }));
  });

  it('does not enroll someone just because they register an account', async () => {
    user = { id: 1 };
    expect(await service.subscribeIfNeeded('new@example.test')).toEqual({ status: 'not_subscribed' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('preserves legacy welcome codes without queuing retroactive welcomes', async () => {
    user = { id: 1, email: 'new@example.test', newsletterSubscribed: false };
    legacy = { code: 'CRX10-ABC234', used: false, userId: 1, type: 'FIRST_ORDER', percent: 10 };
    await service.subscribe('new@example.test');
    expect(legacy.code).toBe('CRX10-ABC234');
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { newsletterSubscribed: true } });
    expect(jobs).toHaveLength(0);
    expect(db.promoCode.create).not.toHaveBeenCalled();
  });
});
