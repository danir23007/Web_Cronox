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
    const tx: any = {
      $executeRaw: jest.fn(),
      product: {
        findMany: jest
          .fn()
          .mockResolvedValue(ordered.map(({ id }) => ({ id }))),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      product: { findMany: jest.fn().mockResolvedValue(ordered) },
      $transaction: jest.fn((argument: any) =>
        typeof argument === 'function' ? argument(tx) : Promise.all(argument),
      ),
    };
    return { tx, prisma, service: new ProductService(prisma) };
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
