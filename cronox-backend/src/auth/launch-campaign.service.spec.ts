/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { LaunchCampaignService } from './launch-campaign.service';
import { KeyScreenService } from '../key-screen/key-screen.service';

describe('durable launch campaign', () => {
  let gate: any;
  let registrations: any[];
  let codes: any[];
  let db: any;
  let mail: any;
  let service: LaunchCampaignService;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://cronox.es';
    gate = { id: 'global', enabled: false, expiresAt: null, launchStatus: 'PENDING',
      launchArmedAt: null, launchStartedAt: null, launchCompletedAt: null,
      launchTrigger: null, launchErrorCode: null,
      activeScreen: { mode: 'PREREGISTRATION', mediaAssetId: 'asset' } };
    registrations = [{ userId: 1, submittedAt: new Date('2026-09-01'), launchCode: null,
      launchClaimedAt: null, launchSentAt: null, launchErrorCode: null,
      user: { email: 'one@example.test', role: 'USER' } }];
    codes = [];
    db = {
      keyScreenSettings: {
        findUnique: jest.fn(async () => gate),
        findUniqueOrThrow: jest.fn(async () => gate),
        upsert: jest.fn(async () => gate),
        update: jest.fn(async ({ data }: any) => Object.assign(gate, data)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.launchStatus && gate.launchStatus !== where.launchStatus) return { count: 0 };
          if (where.enabled !== undefined && gate.enabled !== where.enabled) return { count: 0 };
          if (where.expiresAt?.lte && (!gate.expiresAt || gate.expiresAt > where.expiresAt.lte)) return { count: 0 };
          if (where.OR && !(where.OR.some((item: any) => item.expiresAt === null && gate.expiresAt === null ||
            item.expiresAt?.gt && gate.expiresAt && gate.expiresAt > item.expiresAt.gt))) return { count: 0 };
          Object.assign(gate, data);
          return { count: 1 };
        }),
      },
      preRegistration: {
        findMany: jest.fn(async ({ where }: any) => registrations.filter(registration =>
          ['USER', 'FRIEND'].includes(registration.user.role) &&
          (where.launchSentAt === undefined || registration.launchSentAt === where.launchSentAt) &&
          (where.launchClaimedAt === undefined || registration.launchClaimedAt === where.launchClaimedAt))
          .map(registration => ({ ...registration }))),
        findFirst: jest.fn(async () => registrations.find(registration => registration.launchClaimedAt && !registration.launchSentAt) || null),
        findUniqueOrThrow: jest.fn(async ({ where }: any) => registrations.find(registration => registration.userId === where.userId)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const registration = registrations.find(row => row.userId === where.userId);
          if (!registration || where.launchSentAt === null && registration.launchSentAt !== null ||
              where.launchClaimedAt === null && registration.launchClaimedAt !== null) return { count: 0 };
          Object.assign(registration, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data }: any) => Object.assign(
          registrations.find(row => row.userId === where.userId), data)),
      },
      promoCode: { create: jest.fn(async ({ data }: any) => { codes.push(data); return data; }) },
    };
    db.$transaction = jest.fn(async (fn: any) => fn(db));
    mail = { isLaunchSenderConfigured: jest.fn(() => true), send: jest.fn(async () => ({ messageId: 'accepted' })) };
    service = new LaunchCampaignService(db, mail);
  });

  it('never starts from a disabled unarmed gate, including after a worker restart', async () => {
    await service.tick();
    await new LaunchCampaignService(db, mail).tick();
    expect(gate.launchStatus).toBe('PENDING');
    expect(mail.send).not.toHaveBeenCalled();
    expect(codes).toHaveLength(0);
  });

  it('does not send on an unarmed scheduled opening', async () => {
    gate.enabled = true;
    gate.expiresAt = new Date(Date.now() - 1_000);
    await service.tick();
    expect(gate.launchStatus).toBe('PENDING');
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('does not send on an unarmed manual opening', async () => {
    gate.enabled = true;
    const keyScreen = new KeyScreenService(db, {} as any, mail);
    await keyScreen.setEnabled(false);
    await service.tick();
    expect(gate.launchStatus).toBe('PENDING');
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('requires explicit arming, then a manual opening; creates one account-bound code and 72-hour link', async () => {
    gate.enabled = true;
    const startedAt = Date.now();
    await service.arm();
    await service.tick();
    expect(mail.send).not.toHaveBeenCalled();
    const keyScreen = new KeyScreenService(db, {} as any, mail);
    await keyScreen.setEnabled(false);
    expect(gate.launchStatus).toBe('SENDING');
    expect(gate.launchTrigger).toBe('MANUAL');
    await service.tick();
    expect(gate.launchStatus).toBe('COMPLETED');
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(codes).toEqual([expect.objectContaining({ ownerUserId: 1,
      ownerEmail: 'one@example.test', value: 15, usageLimit: 1, singleUsePerUser: true })]);
    const url = mail.send.mock.calls[0][0].templateData.actionUrl;
    const token = url.split('#')[1];
    expect(url).toMatch(/^https:\/\/cronox\.es\/launch\.html#[a-f0-9]{64}$/);
    expect(registrations[0].launchTokenHash).not.toBe(token);
    expect(registrations[0].launchTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 72 * 60 * 60 * 1000);
    expect(registrations[0].launchTokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 72 * 60 * 60 * 1000);
    expect(mail.send.mock.calls[0][0].templateData.message).toContain('CRONOX ya está abierto');
    gate.enabled = true;
    await keyScreen.setEnabled(false);
    await service.tick();
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('starts an armed campaign on scheduled expiration, including after restart', async () => {
    gate.enabled = true;
    gate.expiresAt = new Date(Date.now() + 60_000);
    await service.arm();
    gate.expiresAt = new Date(Date.now() - 1_000);
    await new LaunchCampaignService(db, mail).tick();
    expect(gate.launchTrigger).toBe('SCHEDULED');
    expect(gate.launchStatus).toBe('COMPLETED');
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('continues pending recipients after a server restart without a browser tab', async () => {
    gate.launchStatus = 'SENDING';
    await new LaunchCampaignService(db, mail).tick();
    expect(gate.launchStatus).toBe('COMPLETED');
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('pauses an in-progress campaign if the key screen is turned on again', async () => {
    gate.launchStatus = 'SENDING';
    gate.enabled = true;
    await service.tick();
    expect(mail.send).not.toHaveBeenCalled();
    gate.enabled = false;
    await service.tick();
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('does not double-send or double-issue a code with concurrent workers', async () => {
    gate.enabled = false;
    gate.launchStatus = 'SENDING';
    await Promise.all([service.tick(), new LaunchCampaignService(db, mail).tick()]);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(codes).toHaveLength(1);
  });

  it('records ambiguous SMTP outcomes and resumes only untouched recipients', async () => {
    gate.launchStatus = 'SENDING';
    registrations.push({ userId: 2, submittedAt: new Date('2026-09-02'), launchCode: null,
      launchClaimedAt: null, launchSentAt: null, user: { email: 'two@example.test', role: 'USER' } });
    mail.send.mockRejectedValueOnce(new Error('SMTP timeout'));
    await service.tick();
    expect(gate.launchStatus).toBe('ERROR');
    expect(registrations[0].launchErrorCode).toBe('UNCERTAIN_DELIVERY');
    expect((await service.preview()).uncertain).toBe(1);
    await new LaunchCampaignService(db, mail).tick();
    expect(mail.send).toHaveBeenCalledTimes(1);
    await service.resume();
    await service.tick();
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(mail.send.mock.calls[1][0].to).toBe('two@example.test');
    expect(codes).toHaveLength(2);
    expect(gate.launchStatus).toBe('SENDING');
  });

  it('stops without claiming a recipient if email is disabled after arming', async () => {
    gate.launchStatus = 'SENDING';
    mail.isLaunchSenderConfigured.mockReturnValue(false);
    await service.tick();
    expect(gate.launchStatus).toBe('ERROR');
    expect(gate.launchErrorCode).toBe('EMAIL_NOT_CONFIGURED');
    expect(registrations[0].launchClaimedAt).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('marks an interrupted old claim uncertain without retrying its email', async () => {
    gate.launchStatus = 'SENDING';
    registrations[0].launchClaimedAt = new Date(Date.now() - 6 * 60_000);
    await new LaunchCampaignService(db, mail).tick();
    expect(gate.launchStatus).toBe('ERROR');
    expect(gate.launchErrorCode).toBe('UNCERTAIN_DELIVERY');
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('refuses to arm without an enabled sender or active preregistration gate', async () => {
    await expect(service.arm()).rejects.toThrow('pantalla de prerregistro');
    gate.enabled = true;
    mail.isLaunchSenderConfigured.mockReturnValue(false);
    await expect(service.arm()).rejects.toThrow('EMAIL_ENABLED');
    expect(mail.send).not.toHaveBeenCalled();
  });
});
