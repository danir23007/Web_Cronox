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

  it('reflects price and availability changes on the next quote without a restart', async () => {
    const source = { shippingMethod: { findMany: jest.fn()
      .mockResolvedValueOnce([{ id: 1, name: 'Standard', price: 490, isActive: true }, { id: 2, name: 'Express', price: 790, isActive: true }])
      .mockResolvedValueOnce([{ id: 1, name: 'Standard updated', price: 590, isActive: true }])
      .mockResolvedValueOnce([]) } };
    const service = new ShippingMethodsService(source as any);
    expect(await service.listAvailableMethods(4000)).toHaveLength(2);
    expect(await service.listAvailableMethods(4000)).toEqual([expect.objectContaining({ label: 'Standard updated', amountCents: 590 })]);
    expect(await service.listAvailableMethods(4000)).toEqual([]);
  });

  it('applies the existing free standard threshold to the net amount after discount', async () => {
    const service = new ShippingMethodsService(prisma as any);
    expect((await service.listAvailableMethods(6500))[0].amountCents).toBe(0);
    expect((await service.listAvailableMethods(6500, 1))[0].amountCents).toBe(395);
    expect((await service.listAvailableMethods(6500))[1].amountCents).toBe(695);
  });
});
