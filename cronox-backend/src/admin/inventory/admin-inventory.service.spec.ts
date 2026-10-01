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
      stockMovement: { create: jest.fn(), findMany: jest.fn() },
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
      totalStock: 0,
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

  it('trims optional notes and rejects more than 500 characters', async () => {
    const update = [{ variantId: 10, stock: 3, expectedStock: 0 }];
    const trimmed = plainToInstance(UpdateInventoryDto, {
      updates: update,
      note: '  Recuento  ',
    });
    expect(await validate(trimmed)).toHaveLength(0);
    expect(trimmed.note).toBe('Recuento');
    const empty = plainToInstance(UpdateInventoryDto, {
      updates: update,
      note: '   ',
    });
    expect(await validate(empty)).toHaveLength(0);
    expect(empty.note).toBeUndefined();
    expect(
      await validate(
        plainToInstance(UpdateInventoryDto, {
          updates: update,
          note: 'x'.repeat(501),
        }),
      ),
    ).not.toHaveLength(0);
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

  it('assigns the same trimmed note to every changed size and preserves the technical reason', async () => {
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(makeProduct());
    prisma.productVariant.findMany.mockResolvedValue([
      { id: 10, size: 'S', sku: 'CORE-S', stockQty: 0 },
      { id: 11, size: 'M', sku: 'CORE-M', stockQty: 8 },
    ]);
    prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.stockMovement.create.mockResolvedValue({ id: 'movement' });
    await service.update(
      1,
      {
        updates: [
          { variantId: 10, stock: 3, expectedStock: 0 },
          { variantId: 11, stock: 6, expectedStock: 8 },
        ],
        note: '  Restock de chaquetas  ',
      },
      7,
    );
    expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
    for (const [call] of prisma.stockMovement.create.mock.calls) {
      expect(call.data).toMatchObject({
        reason: 'inventory_manual',
        note: 'Restock de chaquetas',
        userId: 7,
      });
    }
  });

  it('stores null for an omitted note and creates no movement for an unchanged size', async () => {
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(makeProduct());
    prisma.productVariant.findMany.mockResolvedValue([
      { id: 10, size: 'S', sku: 'CORE-S', stockQty: 0 },
      { id: 11, size: 'M', sku: 'CORE-M', stockQty: 8 },
    ]);
    prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.stockMovement.create.mockResolvedValue({ id: 'movement' });
    await service.update(
      1,
      {
        updates: [
          { variantId: 10, stock: 3, expectedStock: 0 },
          { variantId: 11, stock: 8, expectedStock: 8 },
        ],
      },
      7,
    );
    expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(prisma.stockMovement.create.mock.calls[0][0].data.note).toBeNull();
  });

  it('returns persisted notes and null for old history entries', async () => {
    const old = {
      id: 1,
      createdAt: new Date(),
      reason: 'inventory_manual',
      metadata: { movementId: 'old', previousStock: 1, newStock: 2 },
      actor: { id: 7 },
    };
    const current = {
      ...old,
      id: 2,
      metadata: { movementId: 'new', previousStock: 2, newStock: 4 },
    };
    prisma.product.findUnique.mockResolvedValue({
      id: 1,
      variants: [{ id: 10 }],
    });
    prisma.auditLog.findMany.mockResolvedValue([current, old]);
    prisma.auditLog.count.mockResolvedValue(2);
    prisma.stockMovement.findMany.mockResolvedValue([
      { id: 'new', note: 'Restock' },
      { id: 'old', note: null },
    ]);
    const history = await service.history(1, { page: 1, pageSize: 10 });
    expect(history.items.map((item) => item.note)).toEqual(['Restock', null]);
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
