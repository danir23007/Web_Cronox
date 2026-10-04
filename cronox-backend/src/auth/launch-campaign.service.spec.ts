import { LaunchCampaignService } from './launch-campaign.service';

describe('retired launch delivery', () => {
  it('cannot arm, resume or dispatch pending jobs', async () => {
    const db = { preRegistration: { findMany: jest.fn() } };
    const email = { send: jest.fn() };
    const service = new LaunchCampaignService(db as any, email as any);
    service.onModuleInit();
    await expect(service.arm()).rejects.toThrow('retirado');
    await expect(service.resume()).rejects.toThrow('retirado');
    await service.tick();
    await service.sendBatch();
    expect(email.send).not.toHaveBeenCalled();
    expect(db.preRegistration.findMany).not.toHaveBeenCalled();
  });
  it('preserves historical delivery counts', async () => {
    const db = { keyScreenSettings: { findUnique: jest.fn().mockResolvedValue({ launchStatus: 'COMPLETED' }) },
      preRegistration: { findMany: jest.fn().mockResolvedValue([{ launchSentAt: new Date() }, { launchSentAt: null, launchClaimedAt: null }]) } };
    const service = new LaunchCampaignService(db as any, {} as any);
    expect(await service.preview()).toMatchObject({ sent: 1, pending: 1, emailReady: false });
  });
});
