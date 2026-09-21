/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GalleryPresentationMode } from '@prisma/client';
import { GalleryService } from './gallery.service';

describe('GalleryService carousel configuration', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  let carouselSlots: any[];
  let settings: any;
  let assets: any[];
  let auditLog: { create: jest.Mock };
  let prisma: any;
  let service: GalleryService;

  const makeAsset = (id: string) => ({
    id,
    storageKey: `gallery/${id}.jpg`,
    publicUrl: `https://cdn.example.test/${id}.jpg`,
    variants: {
      galleryGrid: { url: `https://cdn.example.test/${id}-grid.webp` },
      galleryLarge: { url: `https://cdn.example.test/${id}-large.webp` },
    },
    originalFilename: `${id}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 100,
    width: 1200,
    height: 1500,
    description: `Descripción ${id}`,
    products: [],
    createdAt: now,
  });

  const hydrated = (slot: any) => ({
    ...slot,
    asset: assets.find((asset) => asset.id === slot.assetId) ?? null,
  });

  beforeEach(() => {
    settings = null;
    assets = ['A', 'B', 'C', 'D', 'E', 'F'].map(makeAsset);
    carouselSlots = [];
    auditLog = { create: jest.fn(async () => ({})) };
    const galleryCarouselSlot = {
      createMany: jest.fn(async ({ data }: any) => {
        data.forEach(({ position }: any) => {
          if (carouselSlots.some((slot) => slot.position === position)) return;
          carouselSlots.push({
            position,
            assetId: null,
            itemId: null,
            description: null,
            relatedProductIds: null,
            focalX: 50,
            focalY: 50,
            zoom: 1,
            fit: 'COVER',
            tabletFocalX: null,
            tabletFocalY: null,
            tabletZoom: null,
            tabletFit: null,
            mobileFocalX: null,
            mobileFocalY: null,
            mobileZoom: null,
            mobileFit: null,
            revision: 0,
            altText: '',
            instagramUrl: null,
            createdAt: now,
            updatedAt: now,
          });
        });
        carouselSlots.sort((a, b) => a.position - b.position);
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        carouselSlots
          .filter(
            (slot) =>
              !where?.assetId ||
              !('not' in where.assetId) ||
              slot.assetId !== null,
          )
          .sort((a, b) => a.position - b.position)
          .map(hydrated),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const slot = carouselSlots.find(
          (item) => item.position === where.position,
        );
        return slot ? hydrated(slot) : null;
      }),
      count: jest.fn(
        async ({ where }: any = {}) =>
          carouselSlots.filter(
            (slot) =>
              !where?.assetId ||
              !('not' in where.assetId) ||
              slot.assetId !== null,
          ).length,
      ),
      update: jest.fn(async ({ where, data, include }: any) => {
        const slot = carouselSlots.find(
          (item) => item.position === where.position,
        );
        if (!slot) throw new Error('slot missing');
        Object.assign(slot, data, {
          revision: data.revision?.increment
            ? slot.revision + data.revision.increment
            : (data.revision ?? slot.revision),
          updatedAt: now,
        });
        return include ? hydrated(slot) : slot;
      }),
    };
    const gallerySettings = {
      findUnique: jest.fn(async () => settings),
      upsert: jest.fn(async ({ create, update }: any) => {
        settings = settings
          ? {
              ...settings,
              ...update,
              revision: update.revision?.increment
                ? settings.revision + update.revision.increment
                : settings.revision,
            }
          : { ...create, revision: 0, createdAt: now, updatedAt: now };
        return settings;
      }),
    };
    const gallerySlot = { findMany: jest.fn(async () => []) };
    const galleryAsset = {
      findUnique: jest.fn(async ({ where }: any) =>
        assets.find((asset) => asset.id === where.id),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const asset = assets.find((item) => item.id === where.id);
        if (data.description !== undefined)
          asset.description = data.description;
        return asset;
      }),
    };
    const product = {
      findMany: jest.fn(async ({ where }: any) =>
        where?.id?.in?.includes(100)
          ? [
              {
                id: 100,
                slug: 'jacket',
                name: 'Jacket',
                price: 9000,
                currency: 'EUR',
                imageUrl: null,
                isActive: true,
                images: [{ url: 'https://cdn.example.test/jacket.jpg' }],
              },
            ]
          : [],
      ),
    };
    const tx = {
      galleryCarouselSlot,
      gallerySettings,
      galleryAsset,
      product,
      auditLog,
    };
    prisma = {
      ...tx,
      gallerySlot,
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    service = new GalleryService(prisma, {} as any);
  });

  const populate = async (count: number) => {
    await prisma.galleryCarouselSlot.createMany({
      data: [1, 2, 3, 4, 5].map((position) => ({ position })),
    });
    carouselSlots.forEach((slot, index) => {
      if (index < count) {
        slot.assetId = assets[index].id;
        slot.itemId = `item-${index + 1}`;
        slot.altText = `Foto ${assets[index].id}`;
      }
    });
  };

  it('defaults missing settings to MOSAIC and preserves the top-level slots contract', async () => {
    await populate(3);

    const result = await service.getPublicGallery();

    expect(result.mode).toBe(GalleryPresentationMode.MOSAIC);
    expect(result.slots).toHaveLength(13);
    expect(result.carouselItems).toHaveLength(3);
  });

  it('falls back to MOSAIC for an invalid persisted CAROUSEL with fewer than 3 valid assets', async () => {
    await populate(2);
    settings = { id: 'global', activeMode: GalleryPresentationMode.CAROUSEL };

    const result = await service.getPublicGallery();

    expect(result.mode).toBe(GalleryPresentationMode.MOSAIC);
    expect(result.carouselItems.map((item) => item.key)).toEqual([
      'item-1',
      'item-2',
    ]);
  });

  it.each([0, 1, 2])(
    'rejects CAROUSEL activation with %i active items',
    async (count) => {
      await populate(count);

      await expect(
        service.updateMode({ activeMode: GalleryPresentationMode.CAROUSEL }, 9),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(settings).toBeNull();
    },
  );

  it.each([3, 4, 5])(
    'accepts CAROUSEL activation with %i active items',
    async (count) => {
      await populate(count);

      const result = await service.updateMode(
        { activeMode: GalleryPresentationMode.CAROUSEL },
        9,
      );

      expect(result.activeMode).toBe(GalleryPresentationMode.CAROUSEL);
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'gallery.mode.update' }),
        }),
      );
    },
  );

  it('keeps Mosaic and Carousel data intact through repeated mode switches', async () => {
    await populate(3);
    const before = carouselSlots.map((slot) => slot.assetId);

    await service.updateMode(
      { activeMode: GalleryPresentationMode.CAROUSEL },
      9,
    );
    await service.updateMode({ activeMode: GalleryPresentationMode.MOSAIC }, 9);
    await service.updateMode(
      { activeMode: GalleryPresentationMode.CAROUSEL },
      9,
    );

    expect(carouselSlots.map((slot) => slot.assetId)).toEqual(before);
    expect(prisma.gallerySlot.findMany).not.toHaveBeenCalled();
  });

  it('returns optimized variants and original fallback fields in public order', async () => {
    await populate(3);
    settings = { id: 'global', activeMode: GalleryPresentationMode.CAROUSEL };

    const result = await service.getPublicGallery();

    expect(result.mode).toBe(GalleryPresentationMode.CAROUSEL);
    expect(result.carouselItems[0]).toMatchObject({
      key: 'item-1',
      imageSrc: 'https://cdn.example.test/A.jpg',
      variants: {
        galleryGrid: { url: 'https://cdn.example.test/A-grid.webp' },
        galleryLarge: { url: 'https://cdn.example.test/A-large.webp' },
      },
    });
  });

  it('reorders D before B atomically and exposes A D B C publicly', async () => {
    await populate(4);
    settings = { id: 'global', activeMode: GalleryPresentationMode.CAROUSEL };

    await service.reorderCarousel({ sourcePosition: 4, targetPosition: 2 }, 9);
    const result = await service.getPublicGallery();

    expect(result.carouselItems.map((item) => item.alt)).toEqual([
      'Foto A',
      'Foto D',
      'Foto B',
      'Foto C',
    ]);
    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'gallery.carousel.reorder' }),
      }),
    );
  });

  it('persists carousel-only description and ordered products through reload and reorder without editing shared assets', async () => {
    await populate(3);
    settings = { id: 'global', activeMode: GalleryPresentationMode.CAROUSEL };
    const sharedDescription = assets[0].description;
    const saved = await service.updateCarouselSlot(
      1,
      {
        description: 'Solo en carrusel',
        productIds: [100, 100],
      },
      9,
    );
    expect(saved.slot).toMatchObject({
      itemId: 'item-1',
      description: 'Solo en carrusel',
      products: [{ id: 100, slug: 'jacket' }],
    });
    expect(assets[0].description).toBe(sharedDescription);
    expect(prisma.galleryAsset.update).not.toHaveBeenCalled();
    expect(
      (await service.getAdminConfiguration()).carouselSlots[0].description,
    ).toBe('Solo en carrusel');
    await service.reorderCarousel({ sourcePosition: 1, targetPosition: 3 }, 9);
    const publicItems = (await service.getPublicGallery()).carouselItems;
    expect(publicItems[2]).toMatchObject({
      key: 'item-1',
      description: 'Solo en carrusel',
      products: [{ id: 100, slug: 'jacket' }],
    });
    expect(publicItems[0].description).toBeNull();
  });

  it('clears prior carousel metadata and creates a new identity when an image is replaced', async () => {
    await populate(1);
    const mosaicDescription = assets[0].description;
    await service.updateCarouselSlot(1, {
      description: 'Anterior',
      productIds: [100],
    });
    const originalId = carouselSlots[0].itemId;
    const result = await service.updateCarouselSlot(1, {
      assetId: 'B',
      altText: 'Foto B',
    });
    expect(result.slot.itemId).not.toBe(originalId);
    expect(result.slot.description).toBeNull();
    expect(result.slot.products).toEqual([]);
    expect(assets[0].description).toBe(mosaicDescription);
  });

  it('rejects a stale Admin edit without changing the carousel item', async () => {
    await populate(1);
    await expect(
      service.updateCarouselSlot(1, {
        description: 'Obsoleto',
        expectedRevision: 9,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(carouselSlots[0].description).toBeNull();
  });

  it('keeps two carousel uses of the same asset independent from each other and from Mosaic', async () => {
    await populate(2);
    carouselSlots[1].assetId = carouselSlots[0].assetId;
    await service.updateCarouselSlot(1, {
      description: 'Primera selección',
      productIds: [100],
    });
    await service.updateCarouselSlot(2, {
      description: 'Segunda selección',
      productIds: [],
    });
    const items = (await service.getPublicGallery()).carouselItems;
    expect(items[0].imageSrc).toBe(items[1].imageSrc);
    expect(items[0].description).toBe('Primera selección');
    expect(items[1].description).toBe('Segunda selección');
    expect(items[0].products).toHaveLength(1);
    expect(items[1].products).toHaveLength(0);
    expect(assets[0].description).not.toBe(items[0].description);
    expect(assets[0].description).not.toBe(items[1].description);
  });

  it('rejects a sixth placement and keeps the persisted five-position bound', async () => {
    await populate(5);

    await expect(
      service.updateCarouselSlot(6, {
        assetId: 'F',
        altText: 'Foto F',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(carouselSlots).toHaveLength(5);
  });
});
