import { MembershipService } from './membership.service';

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
