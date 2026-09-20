import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from './product.service';

describe('ProductService size-system switching', () => {
  const createHarness = (protectedVariantCount: number) => {
    let sizeSystem = 'APPAREL';
    let createdVariants: Array<Record<string, unknown>> = [];
    const existing = {
      id: 7,
      name: 'Molten Script',
      slug: 'molten-script',
      description: null,
      price: 8900,
      currency: 'EUR',
      sizeSystem,
      isActive: true,
      collection: null,
      searchKeywords: [],
      searchText: 'molten script',
      imageUrl: null,
      updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    };
    const tx = {
      product: {
        findUnique: jest.fn((args: Record<string, unknown>) => {
          if ('include' in args) {
            return Promise.resolve({
              ...existing,
              sizeSystem,
              images: [],
              variants: createdVariants.map((variant, index) => ({
                id: index + 20,
                ...variant,
              })),
            });
          }
          return Promise.resolve({ ...existing, sizeSystem });
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          if (typeof data.sizeSystem === 'string') sizeSystem = data.sizeSystem;
          return Promise.resolve({ ...existing, sizeSystem });
        }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
        count: jest.fn().mockResolvedValue(protectedVariantCount),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        createMany: jest.fn(
          ({ data }: { data: Array<Record<string, unknown>> }) => {
            createdVariants = data;
            return Promise.resolve({ count: data.length });
          },
        ),
      },
      checkoutSnapshotItem: { count: jest.fn().mockResolvedValue(0) },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
      productImage: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    return {
      service: new ProductService(prisma as unknown as PrismaService),
      tx,
      getCreatedVariants: () => createdVariants,
    };
  };

  it('blocks the change before deleting variants when commercial data exists', async () => {
    const harness = createHarness(1);

    await expect(
      harness.service.updateProduct(7, { sizeSystem: 'US_RING' }),
    ).rejects.toThrow(ConflictException);
    expect(harness.tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(harness.tx.productVariant.createMany).not.toHaveBeenCalled();
    expect(harness.tx.product.update).not.toHaveBeenCalled();
  });

  it('atomically replaces unused apparel variants with seven zero-stock ring variants', async () => {
    const harness = createHarness(0);

    await harness.service.updateProduct(7, { sizeSystem: 'US_RING' });

    expect(harness.tx.productVariant.deleteMany).toHaveBeenCalledWith({
      where: { productId: 7 },
    });
    expect(harness.getCreatedVariants().map((variant) => variant.size)).toEqual(
      ['US_6', 'US_7', 'US_8', 'US_9', 'US_10', 'US_11', 'US_12'],
    );
    expect(
      harness.getCreatedVariants().every((variant) => variant.stockQty === 0),
    ).toBe(true);
  });
});
