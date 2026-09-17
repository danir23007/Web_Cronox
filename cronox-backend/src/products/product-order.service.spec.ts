/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
import { BadRequestException } from '@nestjs/common';
import { ProductService } from './product.service';

describe('ProductService product ordering', () => {
  const ordered = [
    {
      id: 3,
      name: 'Three',
      slug: 'three',
      isActive: true,
      displayOrder: 0,
      imageUrl: null,
      images: [],
    },
    {
      id: 1,
      name: 'One',
      slug: 'one',
      isActive: false,
      displayOrder: 1,
      imageUrl: null,
      images: [],
    },
    {
      id: 2,
      name: 'Two',
      slug: 'two',
      isActive: true,
      displayOrder: 2,
      imageUrl: null,
      images: [],
    },
  ];

  const harness = () => {
    const state = ordered.map((product) => ({ ...product }));
    const tx: any = {
      $executeRaw: jest.fn(),
      product: {
        findMany: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(state.map(({ id }) => ({ id }))),
          ),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const product = state.find(({ id }) => id === where.id);
          if (product) product.displayOrder = data.displayOrder;
          return Promise.resolve(product ?? {});
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      product: {
        findMany: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              [...state].sort(
                (left, right) =>
                  left.displayOrder - right.displayOrder || left.id - right.id,
              ),
            ),
          ),
      },
      $transaction: jest.fn((argument: any) =>
        typeof argument === 'function' ? argument(tx) : Promise.all(argument),
      ),
    };
    return { state, tx, prisma, service: new ProductService(prisma) };
  };

  it('retrieves the complete order with stable displayOrder/id sorting', async () => {
    const { service, prisma } = harness();
    await expect(service.getProductOrder()).resolves.toEqual({
      items: ordered,
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('returns a deliberately non-chronological public order unchanged', async () => {
    const names = [
      'SCARRED TEE - black',
      'SCARRED TEE - red',
      'ASHEN SHELL',
      'SHIELDED COAL',
      'MOLTEN SCRIPT',
      'CORE TEE - black',
      'CORE TEE - grey',
    ];
    const products = names.map((name, displayOrder) => ({
      id: [41, 37, 29, 11, 53, 5, 3][displayOrder],
      name,
      displayOrder,
      price: 4000,
      searchKeywords: [],
      searchText: name.toLowerCase(),
      variants: [],
      images: [],
      categories: [],
    }));
    const findMany = jest.fn().mockResolvedValue(products);
    const prisma: any = {
      product: {
        findMany,
        count: jest.fn().mockResolvedValue(products.length),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ProductService(prisma);

    const response = await service.getAllProducts({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(response.items.map((product) => product.name)).toEqual(names);
  });

  it('saves every position under one serialized transaction', async () => {
    const { service, tx, prisma } = harness();
    await expect(service.reorderProducts([2, 3, 1], 9)).resolves.toEqual({
      ok: true,
      productIds: [2, 3, 1],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.update.mock.calls.map(([value]: any[]) => value)).toEqual(
      [
        { where: { id: 2 }, data: { displayOrder: 0 } },
        { where: { id: 3 }, data: { displayOrder: 1 } },
        { where: { id: 1 }, data: { displayOrder: 2 } },
      ],
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns the same complete order after saving and reloading', async () => {
    const { service } = harness();
    await service.reorderProducts([2, 3, 1], 9);

    await expect(service.getProductOrder()).resolves.toEqual({
      items: [
        expect.objectContaining({ id: 2, displayOrder: 0 }),
        expect.objectContaining({ id: 3, displayOrder: 1 }),
        expect.objectContaining({ id: 1, displayOrder: 2 }),
      ],
    });
  });

  it.each([
    [[1, 1, 2], 'duplicate'],
    [[1, 2], 'missing'],
    [[1, 2, 99], 'unknown'],
    [[0, 1, 2], 'invalid'],
  ])('rejects %s IDs (%s) without persisting a partial order', async (ids) => {
    const { service, tx } = harness();
    await expect(
      service.reorderProducts(ids as number[]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('does not report success when a write fails inside the transaction', async () => {
    const { service, tx } = harness();
    tx.product.update.mockRejectedValueOnce(new Error('write failed'));
    await expect(service.reorderProducts([3, 1, 2])).rejects.toThrow(
      'write failed',
    );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
