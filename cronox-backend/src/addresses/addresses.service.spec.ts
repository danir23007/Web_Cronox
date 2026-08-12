import { BadRequestException } from '@nestjs/common';
import { AddressesService } from './addresses.service';

describe('AddressesService country normalization', () => {
  const now = new Date('2026-08-12T12:00:00.000Z');
  const baseAddress = {
    id: 1,
    userId: 7,
    name: 'Daniel Rivas',
    phone: null,
    line1: 'Calle Mayor 1',
    line2: null,
    city: 'Madrid',
    state: 'Madrid',
    zip: '28001',
    country: 'ES',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  const createService = () => {
    const prisma = {
      address: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({
          ...baseAddress,
          ...data,
          id: 2,
        })),
        findMany: jest.fn().mockResolvedValue([baseAddress]),
      },
    };
    return { prisma, service: new AddressesService(prisma as any) };
  };

  it('stores España for a legacy ES create request', async () => {
    const { prisma, service } = createService();
    await service.create(7, {
      name: 'Daniel Rivas',
      line1: 'Calle Mayor 1',
      city: 'Madrid',
      zip: '28001',
      country: 'ES',
    });
    expect(prisma.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ country: 'España' }),
    });
  });

  it('returns legacy persisted ES as España', async () => {
    const { service } = createService();
    await expect(service.list(7)).resolves.toEqual([
      expect.objectContaining({ country: 'España' }),
    ]);
  });

  it('rejects unsupported address countries before persistence', async () => {
    const { prisma, service } = createService();
    await expect(
      service.create(7, {
        name: 'Daniel Rivas',
        line1: 'Calle Mayor 1',
        city: 'Madrid',
        zip: '28001',
        country: 'France',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.address.create).not.toHaveBeenCalled();
  });
});
