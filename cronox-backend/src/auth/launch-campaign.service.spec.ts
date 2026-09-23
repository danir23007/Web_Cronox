import { LaunchCampaignService } from './launch-campaign.service';

describe('Launch campaign', () => {
  let db: any;
  let mail: any;
  let service: LaunchCampaignService;
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://cronox.es';
    db = {
      keyScreenSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: false }) },
      preRegistration: {
        findMany: jest.fn().mockResolvedValue([{ userId: 1 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 1, launchCode: null, user: { email: 'user@example.test' } }),
        update: jest.fn().mockResolvedValue({}),
      },
      promoCode: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn(fn => fn(db));
    mail = { isEnabled: () => true, send: jest.fn().mockResolvedValue({ messageId: 'ok' }) };
    service = new LaunchCampaignService(db, mail);
  });
  it('blocks announcements while the store is closed', async () => {
    db.keyScreenSettings.findUnique.mockResolvedValue({ enabled: true });
    await expect(service.sendBatch()).rejects.toThrow('Abre primero');
    expect(mail.send).not.toHaveBeenCalled();
  });
  it('creates a bound 15% single-use code and stores only the login token hash', async () => {
    const startedAt = Date.now();
    await service.sendBatch();
    expect(db.promoCode.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: 1, ownerEmail: 'user@example.test', value: 15, usageLimit: 1, singleUsePerUser: true,
    }) });
    const url = mail.send.mock.calls[0][0].templateData.actionUrl;
    const token = url.split('#')[1];
    const prepared = db.preRegistration.update.mock.calls[0][0].data;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.launchTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 72 * 60 * 60 * 1000);
    expect(prepared.launchTokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 72 * 60 * 60 * 1000);
    expect(mail.send.mock.calls[0][0].subject).toContain('CRONOX ya está abierto.');
    expect(mail.send.mock.calls[0][0].templateData.message).toContain('caduca en 72 horas');
    expect(mail.send.mock.calls[0][0].templateData.message).not.toContain('descubre la colección');
    expect(prepared.launchTokenHash).not.toEqual(token);
    expect(prepared.launchTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not send when another worker already claimed the recipient', async () => {
    db.preRegistration.updateMany.mockResolvedValue({ count: 0 });
    await service.sendBatch();
    expect(mail.send).not.toHaveBeenCalled();
    expect(db.promoCode.create).not.toHaveBeenCalled();
  });
  it('keeps ambiguous SMTP failures claimed instead of resending', async () => {
    mail.send.mockRejectedValue(new Error('timeout'));
    expect(await service.sendBatch()).toMatchObject({ uncertain: 1, sent: 0 });
    expect(db.preRegistration.updateMany).toHaveBeenCalledTimes(1);
    expect(db.preRegistration.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { launchSentAt: expect.any(Date) } }));
  });
});
