/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';

describe('ProductService category assignments', () => {
  let prisma: any;
  let tx: any;
  let service: ProductService;
  let availableCategoryIds: number[];
  let beforeCategoryIds: number[];

  const updatedProduct = (categoryIds: number[]) => ({
    id: 10,
    name: 'Core Tee',
    slug: 'core-tee',
    price: 3495,
    variants: [],
    images: [],
    categories: categoryIds.map((categoryId) => ({
      categoryId,
      category: { id: categoryId, name: `Category ${categoryId}` },
    })),
  });

  beforeEach(() => {
    availableCategoryIds = [1, 2, 5];
    beforeCategoryIds = [];
    tx = {
      product: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 10 })
          .mockImplementation(() =>
            Promise.resolve(
              updatedProduct(availableCategoryIds.filter((id) => id <= 5)),
            ),
          ),
      },
      category: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            availableCategoryIds
              .filter((id) => where.id.in.includes(id))
              .map((id) => ({ id })),
          ),
        ),
      },
      productCategory: {
        findMany: jest.fn(() =>
          Promise.resolve(
            beforeCategoryIds.map((categoryId) => ({ categoryId })),
          ),
        ),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    prisma = {
      $transaction: jest.fn((callback: (client: any) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    service = new ProductService(prisma);
  });

  it.each([
    ['one category', [1]],
    ['multiple categories', [1, 2, 5]],
  ])('assigns %s without duplicate join rows', async (_label, categoryIds) => {
    await service.replaceProductCategories(10, categoryIds, 7);

    expect(tx.productCategory.deleteMany).toHaveBeenCalledWith({
      where: { productId: 10 },
    });
    expect(tx.productCategory.createMany).toHaveBeenCalledWith({
      data: categoryIds.map((categoryId) => ({ productId: 10, categoryId })),
      skipDuplicates: false,
    });
    expect(new Set(categoryIds).size).toBe(categoryIds.length);
  });

  it('replaces existing assignments and records the before/after IDs', async () => {
    beforeCategoryIds = [1, 2];

    await service.replaceProductCategories(10, [5], 7);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 7,
        action: 'PRODUCT_CATEGORIES_UPDATED',
        metadata: {
          productId: 10,
          beforeCategoryIds: [1, 2],
          afterCategoryIds: [5],
        },
      }),
    });
  });

  it('removes all assignments when the array is empty', async () => {
    await service.replaceProductCategories(10, []);

    expect(tx.productCategory.deleteMany).toHaveBeenCalled();
    expect(tx.productCategory.createMany).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent product', async () => {
    tx.product.findUnique.mockReset().mockResolvedValue(null);

    await expect(
      service.replaceProductCategories(999, [1]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.productCategory.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects nonexistent category IDs before changing assignments', async () => {
    availableCategoryIds = [1];

    await expect(
      service.replaceProductCategories(10, [1, 99]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.productCategory.deleteMany).not.toHaveBeenCalled();
  });

  it.each([[[1, 1]], [[0]], [[-2]], [[1.5]]])(
    'rejects invalid or duplicate category IDs: %j',
    async (categoryIds) => {
      await expect(
        service.replaceProductCategories(10, categoryIds),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('lists assigned categories with admin products without an extra query per item', async () => {
    const item = updatedProduct([1, 2]);
    prisma.product = {
      findMany: jest.fn().mockResolvedValue([item]),
      count: jest.fn().mockResolvedValue(1),
    };
    prisma.$transaction = jest.fn((promises: Promise<unknown>[]) =>
      Promise.all(promises),
    );

    const result = await service.listAdminProducts({});

    expect(result.items[0].categories).toHaveLength(2);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          categories: expect.objectContaining({
            select: expect.objectContaining({ category: expect.any(Object) }),
          }),
        }),
      }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });

  it('public category filtering only returns active assigned products', async () => {
    prisma.product = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    prisma.$transaction = jest.fn((promises: Promise<unknown>[]) =>
      Promise.all(promises),
    );

    await service.getAllProducts({ categorySlug: 'novedades' });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          categories: {
            some: {
              category: { slug: 'novedades', isActive: true },
            },
          },
        },
      }),
    );
  });
});
