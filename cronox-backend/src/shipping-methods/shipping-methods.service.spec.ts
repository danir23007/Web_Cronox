import { BadRequestException } from '@nestjs/common';
import { ShippingMethodsService } from './shipping-methods.service';

describe('ShippingMethodsService country support', () => {
  const prisma = {
    shippingMethod: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, name: 'Estándar', price: 395, isActive: true },
        { id: 2, name: 'Express', price: 695, isActive: true },
      ]),
    },
  };

  beforeEach(() => jest.clearAllMocks());

  it.each(['España', 'ES'])(
    'keeps STANDARD and EXPRESS available for %s',
    async (country) => {
      const service = new ShippingMethodsService(prisma as any);
      await expect(
        service.listAvailableMethods(4500, 0, country),
      ).resolves.toEqual([
        expect.objectContaining({ code: 'STANDARD' }),
        expect.objectContaining({ code: 'EXPRESS' }),
      ]);
    },
  );

  it('rejects unsupported delivery countries', async () => {
    const service = new ShippingMethodsService(prisma as any);
    await expect(
      service.listAvailableMethods(4500, 0, 'France'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
