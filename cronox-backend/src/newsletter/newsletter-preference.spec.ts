import { newsletterVeto, saveNewsletterPreference } from './newsletter-preference';
import { UsersService } from '../users/users.service';
import { GuestOrderAccountService } from '../orders/guest-order-account.service';
import { NewsletterService } from './newsletter.service';
jest.mock('../users/account-welcome', () => ({ ensureAccountWelcome: async (tx: any) => tx.user.findUniqueOrThrow() }));
jest.mock('../users/member-code.util', () => ({ getNextSequentialMemberCode: async () => 'CRX-000111' }));
jest.mock('../users/event-registration', () => ({ recordEventRegistration: jest.fn() }));

function fixture() {
  let user: any = null, sub: any = null, suppression: any = null;
  const events: any[] = [];
  const tx: any = { $executeRaw: jest.fn(),
    auditLog: { create: jest.fn(async ({ data }) => { events.push(data); return data; }), findFirst: jest.fn(async ({ where }) => [...events].reverse().find(e => e.targetType === where.targetType && e.targetId === where.targetId) || null) },
    mailboxSuppression: { findUnique: jest.fn(async () => suppression), upsert: jest.fn(async ({ create, update }) => suppression = suppression ? { ...suppression, ...update } : create) },
    newsletterSubscription: { findUnique: jest.fn(async () => sub), update: jest.fn(async ({ data }) => sub = { ...sub, ...data }), upsert: jest.fn(async ({ create, update }) => sub = sub ? { ...sub, ...update } : { id: 'subscription', ...create }) },
    user: { findFirst: jest.fn(async () => user), findUnique: jest.fn(async () => user), findUniqueOrThrow: jest.fn(async () => user), create: jest.fn(async ({ data }) => user = { id: 1, ...data }), update: jest.fn(async ({ data }) => user = { ...user, ...data }) },
  };
  tx.$transaction = (fn: any) => fn(tx);
  return { tx, events, setUser: (value: any) => user = value, setSub: (value: any) => sub = value, setSuppression: (value: any) => suppression = value, user: () => user, sub: () => sub };
}
describe('explicit newsletter preference and provenance', () => {
  it.each([true, false, undefined])('account creation persists choice=%s without inferring an omitted choice', async choice => {
    const f = fixture();
    await new UsersService(f.tx).createUser({ email: 'person@example.test', password: 'hash', newsletterSubscribed: choice, newsletterSource: 'ACCOUNT_REGISTRATION' });
    expect(f.user().newsletterSubscribed).toBe(choice === true);
    expect(f.events).toHaveLength(choice === undefined ? 0 : 1);
    if (choice !== undefined) expect(f.events[0]).toMatchObject({ reason: 'ACCOUNT_REGISTRATION', metadata: { subscribed: choice, explicit: true } });
    expect(f.events.some(e => JSON.stringify(e).includes('person@example.test'))).toBe(false);
  });
  it.each([true, false])('event registration respects explicit choice=%s', async choice => {
    const f = fixture();
    await new UsersService(f.tx).createUser({ email: 'event@example.test', password: 'hash', eventRegistration: true, newsletterSubscribed: choice, newsletterSource: 'EVENT_REGISTRATION' });
    expect(f.user().newsletterSubscribed).toBe(choice);
    expect(f.events[0].reason).toBe('EVENT_REGISTRATION');
  });
  it('an old subscription cannot override a later refusal, including in a repair', async () => {
    const f = fixture(); f.setSub({ subscribedAt: new Date('2026-01-01'), email: 'person@example.test' });
    await saveNewsletterPreference(f.tx, 'person@example.test', false, 'PREFERENCES_UNSUBSCRIBE');
    expect(await newsletterVeto(f.tx, 'person@example.test')).toBe(true);
    expect(await saveNewsletterPreference(f.tx, 'person@example.test', true, 'GUEST_CHECKOUT_OPT_IN')).toBe(false);
    expect(f.sub().subscribedAt).toEqual(new Date('2026-01-01'));
    expect(f.events).toHaveLength(1);
  });
  it.each(['UNSUBSCRIBED', 'CONFIRMED_HARD_BOUNCE', 'DECLINED'])('creation never overrides suppression %s', async reason => {
    const f = fixture(); f.setSuppression({ reason });
    await new UsersService(f.tx).createUser({ email: 'person@example.test', password: 'hash', newsletterSubscribed: true });
    expect(f.user().newsletterSubscribed).toBe(false);
    expect(f.tx.newsletterSubscription.upsert).not.toHaveBeenCalled();
  });
  it.each([true, false])('guest account consumes the persisted checkout choice=%s', async choice => {
    const f = fixture(); f.events.push({ targetType: 'CHECKOUT_NEWSLETTER_PREFERENCE', targetId: 'checkout', metadata: { subscribed: choice } });
    await new GuestOrderAccountService().resolveUserForCompletedOrder(f.tx, { id: 'checkout', userId: null, customerEmail: 'guest@example.test', shippingAddr: null, billingAddr: null });
    expect(f.user().newsletterSubscribed).toBe(choice);
    expect(f.events.at(-1)).toMatchObject({ reason: 'GUEST_CHECKOUT_ACCOUNT', metadata: { subscribed: choice } });
  });
  it('an existing account purchase preserves the refusal and does not consume a checkout opt-in', async () => {
    const f = fixture(); f.setUser({ id: 1, newsletterSubscribed: false, password: 'hash' });
    f.events.push({ targetType: 'CHECKOUT_NEWSLETTER_PREFERENCE', targetId: 'checkout', metadata: { subscribed: true } });
    await new GuestOrderAccountService().resolveUserForCompletedOrder(f.tx, { id: 'checkout', userId: null, customerEmail: 'guest@example.test', shippingAddr: null, billingAddr: null });
    expect(f.tx.user.update).not.toHaveBeenCalled(); expect(f.user().newsletterSubscribed).toBe(false);
  });
  it('an old email-only subscribe integration creates no consent', async () => {
    const f = fixture(); const service = new NewsletterService(f.tx, {} as any);
    await expect(service.subscribe('person@example.test')).rejects.toThrow('explícita');
    expect(f.tx.newsletterSubscription.upsert).not.toHaveBeenCalled(); expect(f.events).toHaveLength(0);
  });
});
