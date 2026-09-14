/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupabaseStorageService } from '../../common/storage/supabase-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductService } from '../../products/product.service';
import { AdminProductsController } from './admin-products.controller';

describe('Admin product creation and permanent deletion (HTTP integration)', () => {
  let app: INestApplication;
  let nextProductId: number;
  let nextVariantId: number;
  let products: Map<number, any>;
  let variants: Map<number, any>;
  let images: Map<number, any[]>;
  let movements: any[];
  let orderItems: any[];
  let checkoutItems: any[];
  let reservations: any[];
  let idempotencyRequests: Map<string, any>;
  let stockMovementCreate: jest.Mock;

  const productWithRelations = (id: number) => {
    const product = products.get(id);
    if (!product) return null;
    return {
      ...product,
      images: images.get(id) || [],
      variants: [...variants.values()].filter(
        (variant) => variant.productId === id,
      ),
      categories: [],
    };
  };

  beforeEach(async () => {
    nextProductId = 1;
    nextVariantId = 1;
    products = new Map();
    variants = new Map();
    images = new Map();
    movements = [];
    orderItems = [];
    checkoutItems = [];
    reservations = [];
    idempotencyRequests = new Map();
    stockMovementCreate = jest.fn(({ data }) => {
      movements.push({ id: `movement-${movements.length + 1}`, ...data });
    });

    const tx: any = {
      adminProductCreateRequest: {
        create: jest.fn(({ data }) => {
          idempotencyRequests.set(data.idempotencyKey, {
            ...data,
            productId: null,
          });
        }),
        update: jest.fn(({ where, data }) => {
          Object.assign(idempotencyRequests.get(where.idempotencyKey), data);
        }),
      },
      product: {
        create: jest.fn(({ data }) => {
          const id = nextProductId++;
          const nestedImages = data.images?.create || [];
          images.set(
            id,
            nestedImages.map((image, index) => ({
              id: index + 1,
              productId: id,
              ...image,
            })),
          );
          const { images: _nested, ...fields } = data;
          const product = {
            id,
            ...fields,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          products.set(id, product);
          return product;
        }),
        findUnique: jest.fn(({ where }) => productWithRelations(where.id)),
        delete: jest.fn(({ where }) => products.delete(where.id)),
      },
      productVariant: {
        createMany: jest.fn(({ data }) => {
          data.forEach((variant) => {
            const id = nextVariantId++;
            variants.set(id, {
              id,
              ...variant,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          });
          return { count: data.length };
        }),
        deleteMany: jest.fn(({ where }) => {
          [...variants.entries()].forEach(([id, variant]) => {
            if (variant.productId === where.productId) variants.delete(id);
          });
        }),
      },
      productImage: {
        deleteMany: jest.fn(({ where }) => images.delete(where.productId)),
      },
      orderItem: {
        count: jest.fn(
          ({ where }) =>
            orderItems.filter((item) => item.productId === where.productId)
              .length,
        ),
      },
      checkoutSnapshotItem: {
        count: jest.fn(
          ({ where }) =>
            checkoutItems.filter((item) => item.productId === where.productId)
              .length,
        ),
      },
      checkoutStockReservation: {
        count: jest.fn(
          ({ where }) =>
            reservations.filter(
              (item) =>
                variants.get(item.variantId)?.productId ===
                where.variant.productId,
            ).length,
        ),
      },
      stockMovement: {
        create: stockMovementCreate,
        count: jest.fn(
          ({ where }) =>
            movements.filter(
              (item) =>
                variants.get(item.variantId)?.productId ===
                where.variant.productId,
            ).length,
        ),
      },
      galleryAssetProduct: { deleteMany: jest.fn() },
      favorite: { deleteMany: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
      productCategory: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((operation) => operation(tx)),
      adminProductCreateRequest: { findUnique: jest.fn() },
      product: { count: jest.fn().mockResolvedValue(0) },
      productImage: { count: jest.fn().mockResolvedValue(0) },
      galleryAsset: { count: jest.fn().mockResolvedValue(0) },
      websiteMediaAsset: { count: jest.fn().mockResolvedValue(0) },
      emailAsset: { count: jest.fn().mockResolvedValue(0) },
    };
    const storage = {
      deleteProductImages: jest.fn().mockResolvedValue(undefined),
    };
    const allow = { canActivate: () => true };
    const module = await Test.createTestingModule({
      controllers: [AdminProductsController],
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseStorageService, useValue: storage },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(AdminGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const createProduct = (name: string, key: string) =>
    request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Idempotency-Key', key)
      .send({
        name,
        price: 3495,
        imageUrls: [`https://storage.example.test/${name}.png`],
        variants: [
          { size: 'S', stockQty: 8 },
          { size: 'M', stockQty: 3 },
        ],
      });

  it('deletes a mistakenly created product with variants, images and initial stock', async () => {
    const created = await createProduct(
      'Producto duplicado integral',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ).expect(201);
    const productId = created.body.id as number;
    const createdVariants = [...variants.values()].filter(
      (variant) => variant.productId === productId,
    );

    expect(createdVariants.map((variant) => variant.stockQty)).toEqual([8, 3]);
    expect(stockMovementCreate).not.toHaveBeenCalled();
    expect(movements).toHaveLength(0);

    await request(app.getHttpServer())
      .delete(`/api/admin/products/${productId}`)
      .expect(200)
      .expect({ ok: true, productId });

    expect(products.has(productId)).toBe(false);
    expect(
      [...variants.values()].some((variant) => variant.productId === productId),
    ).toBe(false);
    expect(images.has(productId)).toBe(false);
    expect(
      movements.some((movement) =>
        createdVariants.some((variant) => variant.id === movement.variantId),
      ),
    ).toBe(false);
  });

  it('continues returning 409 when commercial order history exists', async () => {
    const created = await createProduct(
      'Producto con pedido integral',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ).expect(201);
    orderItems.push({ productId: created.body.id, orderId: 99 });

    await request(app.getHttpServer())
      .delete(`/api/admin/products/${created.body.id}`)
      .expect(409);

    expect(products.has(created.body.id)).toBe(true);
  });
});
