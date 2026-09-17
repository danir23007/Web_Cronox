/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductService } from './product.service';

const duplicateKeyError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate key', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['idempotencyKey'] },
  });

describe('ProductService administrative lifecycle', () => {
  const product = {
    id: 7,
    name: 'Duplicate tee',
    slug: 'duplicate-tee',
    price: 3495,
    currency: 'EUR',
    description: null,
    collection: null,
    imageUrl:
      'https://storage.example.test/storage/v1/object/public/products/products/a.png',
    isActive: true,
    searchKeywords: [],
    searchText: 'duplicate tee',
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [
      {
        url: 'https://storage.example.test/storage/v1/object/public/products/products/a.png',
      },
    ],
    variants: [],
    categories: [],
  };

  const deletionFixture = (historical = {}) => {
    const tx: any = {
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        delete: jest.fn(),
      },
      orderItem: {
        count: jest.fn().mockResolvedValue(historical['orders'] || 0),
      },
      checkoutSnapshotItem: {
        count: jest.fn().mockResolvedValue(historical['checkout'] || 0),
      },
      checkoutStockReservation: {
        count: jest.fn().mockResolvedValue(historical['reservations'] || 0),
      },
      stockMovement: {
        count: jest.fn().mockResolvedValue(historical['stock'] || 0),
      },
      galleryAssetProduct: { deleteMany: jest.fn() },
      favorite: { deleteMany: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
      productCategory: { deleteMany: jest.fn() },
      productImage: { deleteMany: jest.fn() },
      productVariant: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(tx)),
      product: { count: jest.fn().mockResolvedValue(0) },
      productImage: { count: jest.fn().mockResolvedValue(0) },
      galleryAsset: { count: jest.fn().mockResolvedValue(0) },
      websiteMediaAsset: { count: jest.fn().mockResolvedValue(0) },
      emailAsset: { count: jest.fn().mockResolvedValue(0) },
    };
    const storage = {
      deleteProductImages: jest.fn().mockResolvedValue(undefined),
    };
    return {
      tx,
      prisma,
      storage,
      service: new ProductService(prisma, storage as any),
    };
  };

  it('permanently deletes a new product and its safe dependencies', async () => {
    const { service, tx, storage } = deletionFixture();

    await expect(service.deleteProduct(7, 1)).resolves.toEqual({
      ok: true,
      productId: 7,
    });

    expect(tx.favorite.deleteMany).toHaveBeenCalledWith({
      where: { productId: 7 },
    });
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { variant: { productId: 7 } },
    });
    expect(tx.galleryAssetProduct.deleteMany).toHaveBeenCalled();
    expect(tx.productImage.deleteMany).toHaveBeenCalled();
    expect(tx.productVariant.deleteMany).toHaveBeenCalled();
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(storage.deleteProductImages).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['orders', { orders: 1 }],
    ['checkout snapshots', { checkout: 1 }],
    ['checkout reservations', { reservations: 1 }],
    ['inventory history', { stock: 1 }],
  ])('blocks deletion when linked to %s', async (_label, historical) => {
    const { service, tx } = deletionFixture(historical);
    await expect(service.deleteProduct(7, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.product.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing or repeatedly deleted product', async () => {
    const { service, tx } = deletionFixture();
    tx.product.findUnique.mockResolvedValue(null);
    await expect(service.deleteProduct(7, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not remove a file still referenced by another module', async () => {
    const { service, prisma, storage } = deletionFixture();
    prisma.galleryAsset.count.mockResolvedValue(1);
    await service.deleteProduct(7, 1);
    expect(storage.deleteProductImages).not.toHaveBeenCalled();
  });

  it('creates only one product for two requests with the same idempotency key', async () => {
    const requests = new Map<
      string,
      { requestHash: string; productId: number }
    >();
    let createCount = 0;
    const tx: any = {
      $executeRaw: jest.fn(),
      adminProductCreateRequest: {
        create: jest.fn(({ data }) => {
          if (requests.has(data.idempotencyKey)) throw duplicateKeyError();
          requests.set(data.idempotencyKey, {
            requestHash: data.requestHash,
            productId: 0,
          });
        }),
        update: jest.fn(({ where, data }) => {
          requests.get(where.idempotencyKey)!.productId = data.productId;
        }),
      },
      product: {
        findFirst: jest.fn().mockResolvedValue({ displayOrder: 6 }),
        create: jest.fn(({ data }) => ({
          ...product,
          ...data,
          id: ++createCount,
        })),
        findUnique: jest.fn(({ where }) => ({ ...product, id: where.id })),
      },
      productVariant: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(tx)),
      adminProductCreateRequest: {
        findUnique: jest.fn(({ where }) => {
          const request = requests.get(where.idempotencyKey)!;
          return { ...request, product: { ...product, id: request.productId } };
        }),
      },
    };
    const service = new ProductService(prisma);
    const dto: any = { name: 'Duplicate tee', price: 3495, variants: [] };
    const key = '12345678-1234-4234-8234-123456789012';

    const first = await service.createProduct(dto, 1, key);
    const second = await service.createProduct(dto, 1, key);

    expect(first.id).toBe(second.id);
    expect(createCount).toBe(1);
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ displayOrder: 7 }),
      }),
    );
  });

  it('allows different request keys to create different products', async () => {
    let id = 0;
    const tx: any = {
      $executeRaw: jest.fn(),
      adminProductCreateRequest: { create: jest.fn(), update: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) => ({ ...product, ...data, id: ++id })),
        findUnique: jest.fn(({ where }) => ({ ...product, id: where.id })),
      },
      productVariant: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new ProductService(prisma);
    const dto: any = { name: 'Tee', price: 1000, variants: [] };
    const a = await service.createProduct(
      dto,
      1,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    const b = await service.createProduct(
      { ...dto, name: 'Hoodie' },
      1,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    expect(a.id).not.toBe(b.id);
  });

  it('persists card framing on normal creation and returns it when reopened', async () => {
    let persisted: any;
    const tx: any = {
      $executeRaw: jest.fn(),
      adminProductCreateRequest: { create: jest.fn(), update: jest.fn() },
      product: {
        findFirst: jest.fn().mockResolvedValue({ displayOrder: 6 }),
        create: jest.fn(({ data }) => {
          persisted = { ...product, ...data, id: 91 };
          return persisted;
        }),
        findUnique: jest.fn(() => ({
          ...persisted,
          images: [],
          variants: [],
          categories: [],
        })),
      },
      productVariant: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new ProductService(prisma);

    const reopened: any = await service.createProduct(
      {
        name: 'Framed tee',
        price: 4000,
        variants: [],
        cardImagePositionX: 18,
        cardImagePositionY: 82,
        cardImageZoom: 0.75,
        displayOrder: 7,
      },
      1,
      'framing-test-1234567890',
    );

    expect(tx.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cardImagePositionX: 18,
        cardImagePositionY: 82,
        cardImageZoom: 0.75,
      }),
    });
    expect(reopened).toMatchObject({
      cardImagePositionX: 18,
      cardImagePositionY: 82,
      cardImageZoom: 0.75,
    });
  });

  it('saves edited card framing and restores the exact normalized values', async () => {
    let persisted: any = {
      ...product,
      cardImagePositionX: 50,
      cardImagePositionY: 50,
      cardImageZoom: 1,
    };
    const tx: any = {
      product: {
        findUnique: jest.fn(() => ({ ...persisted })),
        update: jest.fn(({ data }) => {
          persisted = { ...persisted, ...data };
          return persisted;
        }),
      },
      productImage: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new ProductService(prisma);

    const reopened: any = await service.updateProduct(7, {
      cardImagePositionX: 4.25,
      cardImagePositionY: 96.75,
      cardImageZoom: 2.35,
    });

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        cardImagePositionX: 4.25,
        cardImagePositionY: 96.75,
        cardImageZoom: 2.35,
      }),
    });
    expect(reopened).toMatchObject({
      cardImagePositionX: 4.25,
      cardImagePositionY: 96.75,
      cardImageZoom: 2.35,
    });
  });
});
