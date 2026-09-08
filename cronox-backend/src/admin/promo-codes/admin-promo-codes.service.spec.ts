import { PromoCodeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminPromoCodesService } from './admin-promo-codes.service';

describe('AdminPromoCodesService single-use setting', () => {
  let service: AdminPromoCodesService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      promoCode: {
        create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
        update: jest.fn(async ({ data }) => ({ id: 1, ...data })),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      $transaction: jest.fn(),
    };
    service = new AdminPromoCodesService(prisma as PrismaService);
  });

  it.each([
    { requested: true, expected: true },
    { requested: false, expected: false },
    { requested: undefined, expected: false },
  ])(
    'creates a code with singleUsePerUser=$expected when requested=$requested',
    async ({ requested, expected }) => {
      await service.create({
        code: ' once10 ',
        type: PromoCodeType.PERCENT,
        value: 10,
        ...(requested === undefined ? {} : { singleUsePerUser: requested }),
      });

      expect(prisma.promoCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'ONCE10',
          singleUsePerUser: expected,
        }),
      });
    },
  );

  it('persists the setting when an administrator edits a code', async () => {
    await service.update(1, { singleUsePerUser: true });
    expect(prisma.promoCode.update).toHaveBeenLastCalledWith({
      where: { id: 1 },
      data: { singleUsePerUser: true },
    });

    await service.update(1, { singleUsePerUser: false });
    expect(prisma.promoCode.update).toHaveBeenLastCalledWith({
      where: { id: 1 },
      data: { singleUsePerUser: false },
    });
  });

  it('returns the persisted setting when listing codes for editing', async () => {
    prisma.promoCode.findMany.mockResolvedValue([
      { id: 1, code: 'ONCE10', singleUsePerUser: true },
    ]);
    prisma.promoCode.count.mockResolvedValue(1);
    prisma.$transaction.mockResolvedValue([
      [{ id: 1, code: 'ONCE10', singleUsePerUser: true }],
      1,
    ]);

    await expect(service.list({})).resolves.toMatchObject({
      items: [{ id: 1, code: 'ONCE10', singleUsePerUser: true }],
    });
  });
});
