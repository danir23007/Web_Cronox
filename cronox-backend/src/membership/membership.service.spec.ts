import { MembershipService } from './membership.service';
import * as accreditationIdentity from './accreditation-identity';

describe('MembershipService public validation', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const usersService = {
    ensurePublicMemberToken: jest.fn(),
  };

  let service: MembershipService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new MembershipService(prisma as any, usersService as any, {} as any, {} as any);
  });

  it('looks up only an opaque public token and exposes no member data', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 123 });

    await expect(service.getMemberInfo('opaque-public-token')).resolves.toEqual({ valid: true });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { publicMemberToken: 'opaque-public-token' },
      select: { id: true },
    });
  });

  it('does not distinguish an unknown public token with a revealing error', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getMemberInfo('unknown-token')).resolves.toEqual({ valid: false });
  });
});

describe('MembershipService accreditation statistics', () => {
  it('returns all three authoritative purchase figures', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 7, circleLevel: 2, createdAt: new Date('2026-01-01') }) } };
    const historial = { calculatePurchaseStats: jest.fn().mockResolvedValue({ pedidosRealizados: 3, articulosAdquiridos: 7, productosDiferentes: 2 }) };
    const circle = {
      ensureCircleByNetSpent: jest.fn(),
      maybePromoteRequestedCircle: jest.fn(),
      getNetSpent: jest.fn().mockResolvedValue({ toString: () => '75' }),
      getPromotionStatus: jest.fn().mockResolvedValue('none'),
    };
    const service = new MembershipService(prisma as any, {} as any, historial as any, circle as any);

    await expect(service.getMyStats(7)).resolves.toMatchObject({
      pedidosRealizados: 3,
      articulosAdquiridos: 7,
      productosDiferentes: 2,
    });
  });
});

describe('MembershipService accreditation display number', () => {
  const token = 'p'.repeat(32);
  const identityUid = 'c6046947-df98-46d0-a20f-b0ad71d63716';
  let renderQr: jest.SpyInstance;
  beforeEach(() => {
    // This unit contract checks the unchanged input to QR rendering. The
    // disposable PostgreSQL integration test compares actual PNG bytes before
    // and after renumbering; rasterising repeatedly here only adds CPU timing.
    renderQr = jest.spyOn(accreditationIdentity, 'renderAccreditationQr')
      .mockImplementation(async payload => `data:image/png;base64,${Buffer.from(payload).toString('base64')}`);
  });
  afterEach(() => renderQr.mockRestore());
  function setup(id: number) {
    const user = { id, identityUid, firstName: 'Daniel Rivas', circleLevel: 5,
      createdAt: new Date('2020-01-01'), accountState: 'ACTIVE', publicMemberToken: token };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const users = { ensurePublicMemberToken: jest.fn().mockResolvedValue(token) };
    const circle = { ensureCircleByNetSpent: jest.fn(), maybePromoteRequestedCircle: jest.fn() };
    const service = new MembershipService(prisma as any, users as any, {} as any, circle as any);
    return { service, prisma, users, user };
  }

  it.each([1, 23, 1042])('exposes the current database User.id %i separately from identity and QR', async id => {
    const { service, prisma, users } = setup(id);
    const card = await service.getMyAccreditation(id);
    expect(card.registrationNumber).toBe(id);
    expect(card.visibleId).toBe(identityUid);
    expect(card.qrPayload).toBe(`CRX:1:${token}`);
    expect(renderQr).toHaveBeenCalledWith(`CRX:1:${token}`);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id }, select: {
      id: true, identityUid: true, firstName: true, createdAt: true, circleLevel: true,
      accountState: true, publicMemberToken: true,
    } });
    expect(users.ensurePublicMemberToken).toHaveBeenCalledWith(id);
  });

  it('reloads the new current number after controlled renumbering with identical identity and QR', async () => {
    const { service, user, users } = setup(23);
    const first = await service.getMyAccreditation(23);
    user.id = 22; // The existing database numbering rules are simulated here.
    const reloaded = await service.getMyAccreditation(22);
    expect(reloaded.registrationNumber).toBe(22);
    expect(reloaded.visibleId).toBe(first.visibleId);
    expect(reloaded.qrPayload).toBe(first.qrPayload);
    expect(reloaded.qrDataUrl).toBe(first.qrDataUrl);
    expect(renderQr.mock.calls).toEqual([[`CRX:1:${token}`], [`CRX:1:${token}`]]);
    expect(users.ensurePublicMemberToken.mock.calls).toEqual([[23], [22]]);
  });

  it('still rejects unusable accounts instead of exposing their display number', async () => {
    const { service, user } = setup(23);
    user.accountState = 'INACTIVE';
    await expect(service.getMyAccreditation(23)).rejects.toMatchObject({ status: 422 });
  });
});
