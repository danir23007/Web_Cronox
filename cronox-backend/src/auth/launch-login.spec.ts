import { AuthService } from './auth.service';

describe('Launch login token', () => {
  let db: any;
  let sessions: any;
  let service: AuthService;
  beforeEach(() => {
    const user = { id: 1, email: 'user@example.test', role: 'USER', accountState: 'PRE_REGISTERED' };
    db = {
      preRegistration: {
        findUnique: jest.fn().mockResolvedValue({ userId: 1, user, launchTokenUsedAt: null,
          launchTokenExpiresAt: new Date(Date.now() + 60000) }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { update: jest.fn().mockResolvedValue({ ...user, accountState: 'ACTIVE' }) },
    };
    db.$transaction = jest.fn(fn => fn(db));
    sessions = { create: jest.fn().mockResolvedValue({ accessToken: 'token' }) };
    service = new AuthService({ toSafeUser: u => u } as any, {} as any, db, {} as any, {} as any, sessions);
  });
  it('activates the account and issues the usual session after atomic token consumption', async () => {
    expect(await service.consumeLaunchLink('a'.repeat(64))).toHaveProperty('tokens');
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(db.preRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ launchTokenUsedAt: null }),
    }));
  });
  it('rejects a competing token consumption', async () => {
    db.preRegistration.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.consumeLaunchLink('a'.repeat(64))).rejects.toThrow();
    expect(sessions.create).not.toHaveBeenCalled();
  });
  it.each(['expired', 'used', 'admin'])('rejects %s links', async reason => {
    const r = await db.preRegistration.findUnique();
    if (reason === 'expired') r.launchTokenExpiresAt = new Date(0);
    if (reason === 'used') r.launchTokenUsedAt = new Date();
    if (reason === 'admin') r.user.role = 'SUPERADMIN';
    await expect(service.consumeLaunchLink('a'.repeat(64))).rejects.toThrow();
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
