/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  CircleUpgradeRequestStatus,
  CircleUpgradeSocialNetwork,
  OrderStatus,
  Role,
  UserAccountState,
} from '@prisma/client';
import { AdminExportsService } from './admin-exports.service';

const delegate = () => ({ findMany: jest.fn().mockResolvedValue([]) });

const setup = () => {
  const prisma = {
    user: delegate(),
    order: delegate(),
    orderItem: delegate(),
    product: delegate(),
    productVariant: delegate(),
    stockMovement: delegate(),
    circleUpgradeRequest: delegate(),
    circlePromotionRequest: delegate(),
    promoCode: delegate(),
    promoCodeRedemption: delegate(),
    auditLog: {
      ...delegate(),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
  };
  const excel = {
    build: jest.fn().mockResolvedValue(Buffer.from('PK')),
    timestampedFilename: jest.fn().mockReturnValue('export.xlsx'),
  };
  return {
    prisma,
    service: new AdminExportsService(prisma as never, excel as never),
  };
};

describe('Admin export filter mapping', () => {
  it('maps user search, FRIEND role, circle, account state and sort', async () => {
    const { prisma, service } = setup();
    await service.export(
      'usuarios',
      {
        scope: 'filtered',
        q: 'álex + test',
        role: Role.FRIEND,
        circle: 2,
        accountState: UserAccountState.ACTIVE,
        sort: 'email',
        order: 'asc',
      },
      1,
      {},
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: Role.FRIEND,
          circleLevel: 2,
          accountState: UserAccountState.ACTIVE,
          OR: expect.any(Array),
        }),
        orderBy: [{ email: 'asc' }, { id: 'asc' }],
        take: 5001,
      }),
    );
  });

  it('maps the order UI identity search and supports validated status/date/sort', async () => {
    const { prisma, service } = setup();
    await service.export(
      'pedidos',
      {
        scope: 'filtered',
        email: 'buyer+es@example.test',
        status: OrderStatus.PAID,
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-15T23:59:59.999Z',
        sort: 'status',
        order: 'asc',
      },
      1,
      {},
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [OrderStatus.PAID] },
          customerEmail: {
            contains: 'buyer+es@example.test',
            mode: 'insensitive',
          },
          createdAt: expect.any(Object),
        }),
        orderBy: [{ status: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('maps product search, active, category, aggregate stock, dates and stock sort', async () => {
    const { prisma, service } = setup();
    await service.export(
      'productos',
      {
        scope: 'filtered',
        q: 'camiseta ñ',
        isActive: 'true',
        categoryId: 4,
        stockState: 'low',
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-15T23:59:59.999Z',
        sortBy: 'stock',
        sortDir: 'asc',
      },
      1,
      {},
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [7] },
          isActive: true,
          categories: expect.any(Object),
          createdAt: expect.any(Object),
          OR: expect.any(Array),
        }),
        take: 5001,
      }),
    );
  });

  it('maps inventory search, active state and aggregate zero/low/sufficient stock', async () => {
    for (const stockStatus of ['out_of_stock', 'low', 'in_stock'] as const) {
      const { prisma, service } = setup();
      await service.export(
        'inventario',
        {
          scope: 'filtered',
          search: 'SKU A/B',
          isActive: 'false',
          stockStatus,
        },
        1,
        {},
      );
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const variantWhere =
        prisma.productVariant.findMany.mock.calls[0][0].where;
      expect(variantWhere.product).toEqual(
        expect.objectContaining({ id: { in: [7] }, isActive: false }),
      );
      expect(variantWhere).not.toHaveProperty('stockQty');
    }
  });

  it('maps circle request type, status, attempts, social network, circle, dates and sort', async () => {
    const { prisma, service } = setup();
    await service.export(
      'circulos',
      {
        scope: 'filtered',
        q: 'persona',
        requestType: '3-4',
        status: CircleUpgradeRequestStatus.PENDING,
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-15T23:59:59.999Z',
        attemptsMin: 2,
        attemptsMax: 5,
        socialNetwork: CircleUpgradeSocialNetwork.INSTAGRAM,
        userCircle: 3,
        sortBy: 'attempts',
        sortDir: 'asc',
      },
      1,
      {},
    );
    expect(prisma.circleUpgradeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fromCircle: 3,
          toCircle: 4,
          status: CircleUpgradeRequestStatus.PENDING,
          socialNetwork: CircleUpgradeSocialNetwork.INSTAGRAM,
          requestNumber: { gte: 2, lte: 5 },
          createdAt: expect.any(Object),
          user: expect.objectContaining({ circleLevel: 3 }),
        }),
        orderBy: [{ requestNumber: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(
      prisma.circlePromotionRequest.findMany.mock.calls[0][0].where,
    ).toEqual(expect.objectContaining({ id: { in: [] } }));
  });

  it('maps only the promo-code controls that exist: search and active state', async () => {
    const { prisma, service } = setup();
    await service.export(
      'codigos',
      { scope: 'filtered', q: 'OTOÑO 20', isActive: 'false' },
      1,
      {},
    );
    expect(prisma.promoCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          code: { contains: 'OTOÑO 20', mode: 'insensitive' },
          isActive: false,
        },
      }),
    );
  });

  it('maps activity actor/search, action, target and dates', async () => {
    const { prisma, service } = setup();
    await service.export(
      'actividad',
      {
        scope: 'filtered',
        q: 'admin@example.test',
        actionType: 'admin.users.update',
        targetType: 'usuario',
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-15T23:59:59.999Z',
      },
      1,
      {},
    );
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { targetType: 'usuario' },
        { createdAt: expect.any(Object) },
        expect.objectContaining({ OR: expect.any(Array) }),
      ]),
    );
  });
});
