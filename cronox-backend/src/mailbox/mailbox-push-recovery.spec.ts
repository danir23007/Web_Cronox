import { UnauthorizedException } from '@nestjs/common';
import { AdminEventPushService } from './admin-event-push.service';
import { MailboxPushService } from './mailbox-push.service';
import * as security from './mailbox-security';

// Every dependency is synthetic: no database, provider call or real subscription.
describe('Push authorization failures remain recoverable without bypassing grants', () => {
  const instant = new Date('2026-10-18T00:00:00Z');
  beforeEach(() => jest.useFakeTimers().setSystemTime(instant));
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function deviceFixture() {
    const device: any = {
      id: 'synthetic-device',
      active: true,
      leaseUntil: null,
      userId: 1,
      sessionId: 'synthetic-session',
      sessionVersion: 1,
      mailEnabled: true,
      mailboxIds: ['synthetic-box'],
      cursorAt: instant,
      nextPushAt: instant,
      visitsSince: instant,
    };
    const updateMany = jest.fn(async ({ where, data }: any) => {
      if (where.active && !device.active) return { count: 0 };
      if (
        where.leaseUntil instanceof Date &&
        device.leaseUntil?.getTime() !== where.leaseUntil.getTime()
      )
        return { count: 0 };
      if (where.OR && device.leaseUntil && device.leaseUntil > instant)
        return { count: 0 };
      Object.assign(device, data);
      return { count: 1 };
    });
    return {
      device,
      model: {
        updateMany,
        findUniqueOrThrow: jest.fn(async () => ({ ...device })),
      },
    };
  }

  it('keeps a mail device and its cursor after a transient session-store failure', async () => {
    const f = deviceFixture();
    const validate = jest
      .fn()
      .mockRejectedValueOnce(new Error('synthetic DB outage'))
      .mockResolvedValue({ userId: 1, user: { role: 'SUPERADMIN' } });
    const push = new MailboxPushService(
      { mailboxPushDevice: f.model } as any,
      { allowedIds: async () => ['synthetic-box'] } as any,
      { validate } as any,
    );
    const notices = jest.spyOn(push, 'notices').mockResolvedValue({
      cursor: new Date(instant.getTime() + 300000).toISOString(),
      notices: [],
    });
    await push.deliver(f.device.id);
    expect(f.device.active).toBe(true);
    expect(f.device.cursorAt).toEqual(instant);
    expect(f.device.nextPushAt).toEqual(new Date(instant.getTime() + 300000));
    expect(f.device.leaseUntil).toBeNull();
    expect(notices).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300000);
    await push.deliver(f.device.id);
    expect(notices).toHaveBeenCalledTimes(1);
    expect(f.device.active).toBe(true);
  });

  it('still disables a mail device for a confirmed revoked session', async () => {
    const f = deviceFixture();
    const push = new MailboxPushService(
      { mailboxPushDevice: f.model } as any,
      {} as any,
      {
        validate: async () => {
          throw new UnauthorizedException();
        },
      } as any,
    );
    await push.deliver(f.device.id);
    expect(f.device.active).toBe(false);
    expect(f.device.cursorAt).toEqual(instant);
    expect(f.device.leaseUntil).toBeNull();
  });

  it('reauthorizes the same subscription through a new legitimate session without resetting preferences or replaying old mail', async () => {
    jest
      .spyOn(security, 'resolvePublic')
      .mockResolvedValue({ address: '8.8.8.8', family: 4 });
    jest
      .spyOn(security, 'encrypt')
      .mockReturnValue('synthetic-encrypted-subscription');
    const saved: any = {
      id: 'synthetic-device',
      userId: 1,
      active: false,
      sessionId: 'expired-session',
      sessionVersion: 1,
      mailEnabled: false,
      mailboxIds: ['chosen-box'],
      name: 'Existing iPhone',
      details: true,
      paidOrdersSince: instant,
      visitsSince: null,
      waitlistSince: instant,
      preferenceRevision: 7,
      cursorAt: new Date(0),
    };
    const db: any = {
      mailboxPushDevice: {
        findUnique: jest.fn(async () => ({ ...saved })),
        upsert: jest.fn(async ({ update }) => Object.assign(saved, update)),
      },
    };
    const push = new MailboxPushService(
      db,
      { allowedIds: async () => ['chosen-box', 'other-box'] } as any,
      {} as any,
    );
    jest
      .spyOn(push, 'config')
      .mockReturnValue({ publicKey: 'synthetic', configured: true });
    await push.subscribe(
      { id: 1, role: 'SUPERADMIN' },
      { sid: 'new-session', sv: 2 },
      {
        name: 'Should not replace',
        details: false,
        mailboxIds: ['chosen-box', 'other-box'],
        subscription: {
          endpoint: 'https://web.push.apple.com/synthetic',
          keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
        },
      },
    );
    expect(saved).toMatchObject({
      active: true,
      sessionId: 'new-session',
      sessionVersion: 2,
      name: 'Existing iPhone',
      mailEnabled: false,
      mailboxIds: ['chosen-box'],
      details: true,
      paidOrdersSince: instant,
      visitsSince: null,
      waitlistSince: instant,
      preferenceRevision: 7,
      cursorAt: instant,
    });
    expect(db.mailboxPushDevice.upsert).toHaveBeenCalledTimes(1);
  });

  function eventFixture() {
    const f = deviceFixture();
    const delivery: any = {
      eventId: 'visits:synthetic',
      deviceId: f.device.id,
      status: 'PENDING',
      readyAt: instant,
      attempts: 0,
      enabledSince: instant,
      event: {
        id: 'visits:synthetic',
        kind: 'visits',
        payload: { visitorId: 1 },
      },
    };
    const apply = (data: any) => {
      const attempts = data.attempts;
      Object.assign(delivery, data);
      if (attempts?.increment)
        delivery.attempts = (apply as any).attempts + attempts.increment;
      if (attempts?.decrement)
        delivery.attempts = (apply as any).attempts - attempts.decrement;
      (apply as any).attempts = delivery.attempts;
    };
    (apply as any).attempts = 0;
    const model = {
      findFirst: jest.fn(async () =>
        delivery.status === 'PENDING' && delivery.readyAt <= new Date()
          ? { ...delivery }
          : null,
      ),
      update: jest.fn(async ({ data }) => {
        apply(data);
        return delivery;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (delivery.status !== where.status) return { count: 0 };
        if (
          where.startedAt &&
          delivery.startedAt?.getTime() !== where.startedAt.getTime()
        )
          return { count: 0 };
        apply(data);
        return { count: 1 };
      }),
    };
    const validate = jest.fn(async () => ({
      userId: 1,
      user: { role: 'SUPERADMIN' },
    }));
    const transmitted = jest.fn();
    const push: any = {
      config: () => ({ configured: true }),
      sessions: { validate },
      sendPayload: jest.fn(async (_device, payload, before) => {
        await before();
        transmitted(payload);
      }),
    };
    const visit = jest.fn(async () => ({
      disposition: 'normal',
      observedRole: null,
      browserLinks: [],
    }));
    const events = new AdminEventPushService(
      {
        mailboxPushDevice: f.model,
        mailboxPushDelivery: model,
        dailyVisitor: { findUnique: visit },
      } as any,
      push,
    );
    return { ...f, delivery, model, validate, transmitted, visit, events };
  }

  it.each([1, 2, 3])(
    'defers a session-store failure at authorization check %s and later delivers once',
    async (failedCall) => {
      const f = eventFixture();
      for (let call = 1; call < failedCall; call++)
        f.validate.mockResolvedValueOnce({
          userId: 1,
          user: { role: 'SUPERADMIN' },
        });
      f.validate.mockRejectedValueOnce(new Error('synthetic DB outage'));
      await f.events.deliver(f.device.id);
      expect(f.delivery.status).toBe('PENDING');
      expect(f.delivery.errorCode).toBe('PUSH_VALIDATION_UNAVAILABLE');
      expect(f.delivery.readyAt).toEqual(new Date(instant.getTime() + 30000));
      expect(f.delivery.attempts).toBe(0);
      expect(f.device.active).toBe(true);
      expect(f.transmitted).not.toHaveBeenCalled();
      await f.events.deliver(f.device.id);
      expect(f.transmitted).not.toHaveBeenCalled();
      jest.advanceTimersByTime(30000);
      await f.events.deliver(f.device.id);
      expect(f.delivery.status).toBe('ACCEPTED');
      expect(f.transmitted).toHaveBeenCalledTimes(1);
      await f.events.deliver(f.device.id);
      expect(f.transmitted).toHaveBeenCalledTimes(1);
    },
  );

  it.each([1, 2, 3])(
    'never delivers after confirmed revocation at authorization check %s',
    async (failedCall) => {
      const f = eventFixture();
      for (let call = 1; call < failedCall; call++)
        f.validate.mockResolvedValueOnce({
          userId: 1,
          user: { role: 'SUPERADMIN' },
        });
      f.validate.mockRejectedValueOnce(new UnauthorizedException());
      await f.events.deliver(f.device.id);
      expect(f.delivery.status).toBe('SKIPPED');
      expect(f.transmitted).not.toHaveBeenCalled();
    },
  );

  it('preserves a pending event when rechecking business state cannot reach the database', async () => {
    const f = eventFixture();
    f.visit.mockRejectedValueOnce(new Error('synthetic DB outage'));
    await f.events.deliver(f.device.id);
    expect(f.delivery.status).toBe('PENDING');
    expect(f.delivery.attempts).toBe(0);
    expect(f.transmitted).not.toHaveBeenCalled();
  });
});
