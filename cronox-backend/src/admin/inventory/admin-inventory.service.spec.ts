/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminInventoryService } from './admin-inventory.service';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

const makeProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Camiseta Core',
  slug: 'camiseta-core',
  imageUrl: null,
  isActive: false,
  images: [],
  variants: [
    {
      id: 10,
      size: 'S',
      sku: 'CORE-S',
      stockQty: 0,
      isActive: true,
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    },
    {
      id: 11,
      size: 'M',
      sku: 'CORE-M',
      stockQty: 8,
      isActive: false,
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    },
  ],
  ...overrides,
});

describe('AdminInventoryService', () => {
  let prisma: any;
  let service: AdminInventoryService;

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      productVariant: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      stockMovement: { create: jest.fn() },
      auditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(async (input: unknown) => {
        if (typeof input === 'function') return input(prisma);
        return Promise.all(input as Promise<unknown>[]);
      }),
    };
    service = new AdminInventoryService(prisma);
  });

  it('returns inactive products and every real variant, including zero-stock and inactive variants', async () => {
    prisma.product.findMany.mockResolvedValue([makeProduct()]);
    prisma.product.count.mockResolvedValue(1);

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      isActive: false,
      totalStock: 8,
      variantCount: 2,
    });
    expect(result.items[0].variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 10,
          stockQty: 0,
          status: 'out_of_stock',
        }),
        expect.objectContaining({ id: 11, isActive: false, stockQty: 8 }),
      ]),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('combines search, active status, and stock filters on the server', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1 }]);
    prisma.product.findMany.mockResolvedValue([
      makeProduct({ isActive: true }),
    ]);
    prisma.product.count.mockResolvedValue(1);

    await service.list({
      search: 'CORE-S',
      isActive: 'true',
      stockStatus: 'low',
      page: 2,
      pageSize: 10,
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          id: { in: [1] },
          OR: expect.any(Array),
        }),
        skip: 10,
        take: 10,
      }),
    );
  });

  it.each([
    [{ updates: [{ variantId: 10, stock: -1, expectedStock: 0 }] }],
    [{ updates: [{ variantId: 10, stock: 1.5, expectedStock: 0 }] }],
    [{ updates: [{ variantId: 10, stock: Number.NaN, expectedStock: 0 }] }],
  ])('rejects invalid stock DTO values: %p', async (payload) => {
    const dto = plainToInstance(UpdateInventoryDto, payload);
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('updates multiple variants atomically and records traceable manual history', async () => {
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(
        makeProduct({
          variants: [
            { ...makeProduct().variants[0], stockQty: 3 },
            { ...makeProduct().variants[1], stockQty: 6 },
          ],
        }),
      );
    prisma.productVariant.findMany.mockResolvedValue([
      { id: 10, size: 'S', sku: 'CORE-S', stockQty: 0 },
      { id: 11, size: 'M', sku: 'CORE-M', stockQty: 8 },
    ]);
    prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.stockMovement.create
      .mockResolvedValueOnce({ id: 'movement-1' })
      .mockResolvedValueOnce({ id: 'movement-2' });
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.update(
      1,
      {
        updates: [
          { variantId: 10, stock: 3, expectedStock: 0 },
          { variantId: 11, stock: 6, expectedStock: 8 },
        ],
      },
      7,
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(prisma.productVariant.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 10, productId: 1, stockQty: 0 },
      data: { stockQty: 3 },
    });
    expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 7,
        actionType: 'INVENTORY_STOCK_UPDATED',
        metadata: expect.objectContaining({
          previousStock: 0,
          newStock: 3,
          delta: 3,
        }),
      }),
    });
    expect(result.variants[0].stockQty).toBe(3);
  });

  it('rejects a variant submitted through the wrong product without writing history', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 1 });
    prisma.productVariant.findMany.mockResolvedValue([]);

    await expect(
      service.update(
        1,
        { updates: [{ variantId: 99, stock: 2, expectedStock: 0 }] },
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails the transaction on a concurrent stock change instead of overwriting it', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 1 });
    prisma.productVariant.findMany.mockResolvedValue([
      { id: 10, size: 'S', sku: 'CORE-S', stockQty: 3 },
    ]);
    prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(
        1,
        { updates: [{ variantId: 10, stock: 9, expectedStock: 3 }] },
        7,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate variant IDs before starting a transaction', async () => {
    await expect(
      service.update(
        1,
        {
          updates: [
            { variantId: 10, stock: 2, expectedStock: 0 },
            { variantId: 10, stock: 3, expectedStock: 0 },
          ],
        },
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
