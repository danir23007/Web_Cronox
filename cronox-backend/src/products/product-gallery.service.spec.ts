/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConflictException } from '@nestjs/common';
import { ProductService } from './product.service';

describe('ProductService gallery manager', () => {
  const updatedAt = new Date('2026-09-17T10:00:00.000Z');
  const existing = {
    id: 10,
    name: 'Gallery tee',
    slug: 'gallery-tee',
    price: 4000,
    currency: 'EUR',
    description: null,
    collection: null,
    imageUrl:
      'https://storage.example.test/storage/v1/object/public/products/products/a.png',
    isActive: true,
    searchKeywords: [],
    searchText: 'gallery tee',
    createdAt: new Date(),
    updatedAt,
  };
  const images = [
    {
      id: 1,
      productId: 10,
      url: 'https://storage.example.test/storage/v1/object/public/products/products/a.png',
      alt: '',
      sortOrder: 0,
      isPrimary: true,
      isActive: true,
      galleryPositionX: 50,
      galleryPositionY: 50,
      galleryZoom: 1,
      galleryFit: 'CONTAIN',
    },
    {
      id: 2,
      productId: 10,
      url: 'https://storage.example.test/storage/v1/object/public/products/products/b.png',
      alt: '',
      sortOrder: 1,
      isPrimary: false,
      isActive: true,
      galleryPositionX: 50,
      galleryPositionY: 50,
      galleryZoom: 1,
      galleryFit: 'CONTAIN',
    },
  ];

  const galleryDto = () => ({
    expectedUpdatedAt: updatedAt.toISOString(),
    galleryImages: [
      {
        ...images[1],
        alt: 'Vista trasera',
        sortOrder: 0,
        isPrimary: true,
        galleryPositionX: 20,
        galleryPositionY: 80,
        galleryZoom: 1.7,
        galleryFit: 'COVER' as const,
      },
      {
        ...images[0],
        alt: 'Vista frontal',
        sortOrder: 1,
        isPrimary: false,
        galleryPositionX: 75,
        galleryPositionY: 25,
        galleryZoom: 0.8,
        galleryFit: 'CONTAIN' as const,
      },
    ],
  });

  const fixture = () => {
    const finalProduct = { ...existing, images, variants: [], categories: [] };
    const tx: any = {
      product: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValue(finalProduct),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(images)
          .mockResolvedValue(images),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)) };
    return { service: new ProductService(prisma), tx, prisma };
  };

  it('persists independent framing, order, alt text and exactly one primary atomically', async () => {
    const { service, tx } = fixture();
    await service.updateProduct(10, galleryDto(), 4);

    expect(tx.productImage.updateMany).toHaveBeenCalledWith({
      where: { productId: 10 },
      data: { isPrimary: false },
    });
    expect(tx.productImage.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: expect.objectContaining({
        alt: 'Vista trasera',
        sortOrder: 0,
        isPrimary: true,
        galleryPositionX: 20,
        galleryPositionY: 80,
        galleryZoom: 1.7,
        galleryFit: 'COVER',
      }),
    });
    expect(tx.productImage.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        alt: 'Vista frontal',
        sortOrder: 1,
        isPrimary: false,
        galleryPositionX: 75,
        galleryPositionY: 25,
        galleryZoom: 0.8,
      }),
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { imageUrl: images[1].url },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'product.gallery.update' }),
    });
  });

  it('rejects stale sessions before changing the gallery', async () => {
    const { service, tx } = fixture();
    await expect(
      service.updateProduct(
        10,
        { ...galleryDto(), expectedUpdatedAt: '2026-09-16T10:00:00.000Z' },
        4,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.productImage.updateMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate positions or more than one primary', async () => {
    const { service } = fixture();
    const dto = galleryDto();
    dto.galleryImages[1].sortOrder = 0;
    dto.galleryImages[1].isPrimary = true;
    await expect(service.updateProduct(10, dto, 4)).rejects.toThrow(
      /exactamente una imagen principal|consecutivo/,
    );
  });

  it('keeps the archived row retryable when storage deletion fails', async () => {
    const archived = {
      ...images[1],
      isActive: false,
      isPrimary: false,
      archivedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      storageKey: null,
      deletionState: null,
    };
    const tx: any = {
      product: {
        findUnique: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      productImage: {
        findFirst: jest.fn().mockResolvedValue(archived),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      galleryAsset: { count: jest.fn().mockResolvedValue(0) },
      websiteMediaAsset: { count: jest.fn().mockResolvedValue(0) },
      emailAsset: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(tx)),
      productImage: { updateMany: jest.fn() },
    };
    const storage = {
      isManagedProductImage: jest.fn().mockReturnValue(true),
      deleteProductImages: jest
        .fn()
        .mockRejectedValue(new Error('storage down')),
    };
    const service = new ProductService(prisma, storage as any);

    await expect(
      service.permanentlyDeleteArchivedImage(10, 2, updatedAt.toISOString(), 4),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.productImage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 2,
        productId: 10,
        isActive: false,
        deletionState: 'PENDING',
      },
      data: { deletionState: null },
    });
  });
});
