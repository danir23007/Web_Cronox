/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { GalleryPlaceholderColor } from '@prisma/client';
import { GalleryService } from './gallery.service';

describe('GalleryService', () => {
  let slots: any[];
  let assets: any[];
  let products: any[];
  let prisma: any;
  let storage: any;
  let service: GalleryService;

  const asset = (id: string, createdAt = new Date('2026-08-14T10:00:00Z')) => ({
    id,
    storageKey: `fotos-antiguas/2026/08/${id}.png`,
    publicUrl: `https://storage.example.test/${id}.png`,
    originalFilename: `${id}.png`,
    mimeType: 'image/png',
    fileSize: 128,
    width: 800,
    height: 800,
    description: null,
    products: [],
    createdAt,
  });

  const withAsset = (slot: any) => ({
    ...slot,
    asset: assets.find((item) => item.id === slot.assetId) || null,
  });

  beforeEach(() => {
    slots = [];
    assets = [];
    products = [
      {
        id: 1,
        slug: 'grey-core-tee',
        name: 'GREY-CORE TEE',
        price: 3495,
        currency: 'EUR',
        imageUrl: null,
        isActive: true,
        images: [{ url: 'https://storage.example.test/grey.png' }],
      },
      {
        id: 2,
        slug: 'archive-tee',
        name: 'ARCHIVE TEE',
        price: 2995,
        currency: 'EUR',
        imageUrl: 'https://storage.example.test/archive.png',
        isActive: false,
        images: [],
      },
    ];
    const gallerySlot = {
      createMany: jest.fn(async ({ data }: any) => {
        data.forEach((definition: any) => {
          if (slots.some((slot) => slot.key === definition.key)) return;
          slots.push({
            ...definition,
            assetId: null,
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
            createdAt: new Date('2026-08-14T10:00:00Z'),
            updatedAt: new Date('2026-08-14T10:00:00Z'),
          });
        });
        return { count: data.length };
      }),
      findMany: jest.fn(async () =>
        [...slots]
          .sort((left, right) => left.displayOrder - right.displayOrder)
          .map(withAsset),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const slot = slots.find((item) => item.key === where.key);
        return slot ? withAsset(slot) : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = slots.findIndex((item) => item.key === where.key);
        const nextRevision = data.revision?.increment
          ? (slots[index].revision || 0) + data.revision.increment
          : (data.revision ?? slots[index].revision);
        slots[index] = {
          ...slots[index],
          ...data,
          revision: nextRevision,
          updatedAt: new Date('2026-08-14T11:00:00Z'),
        };
        return withAsset(slots[index]);
      }),
    };
    const galleryAsset = {
      findMany: jest.fn(async () => [...assets].reverse()),
      count: jest.fn(async () => assets.length),
      findUnique: jest.fn(async ({ where }: any) => {
        const found = assets.find((item) => item.id === where.id);
        return found || null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = {
          id: `asset-${assets.length + 1}`,
          createdAt: new Date('2026-08-14T10:00:00Z'),
          description: null,
          products: [],
          ...data,
        };
        assets.push(created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const found = assets.find((item) => item.id === where.id);
        if (!found) throw new Error('asset not found');
        if ('description' in data) found.description = data.description;
        if (data.products) {
          found.products = (data.products.create || []).map((item: any) => ({
            id: item.position + 1,
            galleryAssetId: found.id,
            productId: item.productId,
            position: item.position,
            createdAt: new Date(),
            product: products.find((product) => product.id === item.productId),
          }));
        }
        return found;
      }),
    };
    const product = {
      findMany: jest.fn(async ({ where }: any) => {
        const ids = where?.id?.in;
        return Array.isArray(ids)
          ? products
              .filter((item) => ids.includes(item.id))
              .map(({ id }) => ({ id }))
          : products;
      }),
      count: jest.fn(async () => products.length),
    };
    const auditLog = { create: jest.fn(async () => ({})) };
    prisma = {
      gallerySlot,
      galleryAsset,
      product,
      auditLog,
      $transaction: jest.fn(async (callback: any) => {
        const previousSlots = slots.map((slot) => ({ ...slot }));
        const previousAssets = assets.map((item) => ({
          ...item,
          products: [...(item.products || [])],
        }));
        try {
          return await callback({
            gallerySlot,
            galleryAsset,
            product,
            auditLog,
          });
        } catch (error) {
          slots.splice(0, slots.length, ...previousSlots);
          assets.splice(0, assets.length, ...previousAssets);
          throw error;
        }
      }),
    };
    storage = {
      uploadGalleryImage: jest.fn(async () => ({
        storageKey: 'fotos-antiguas/2026/08/new.png',
        publicUrl: 'https://storage.example.test/new.png',
        originalFilename: 'new.png',
        mimeType: 'image/png',
        fileSize: 128,
        width: 800,
        height: 600,
      })),
    };
    service = new GalleryService(prisma, storage);
  });

  it('always returns the stable 13-slot public composition with fallback colors', async () => {
    const result = await service.getPublicGallery();

    expect(result.slots).toHaveLength(13);
    expect(result.slots[0]).toMatchObject({
      key: 'featured',
      displayOrder: 0,
      featured: true,
      placeholderColor: 'grey',
      imageSrc: null,
    });
    expect(result.slots.slice(1)).toHaveLength(12);
    expect(prisma.gallerySlot.createMany).not.toHaveBeenCalled();
  });

  it('persists an upload in the asset library without assigning or deleting it', async () => {
    const uploaded = await service.uploadAsset({} as Express.Multer.File, 9);
    const library = await service.getAssetLibrary();

    expect(storage.uploadGalleryImage).toHaveBeenCalledWith(
      expect.anything(),
      9,
    );
    expect(uploaded.asset.id).toBe('asset-1');
    expect(library.assets).toHaveLength(1);
    expect(slots).toHaveLength(0);
  });

  it('replaces a slot image while retaining both old and new library assets', async () => {
    assets.push(asset('old'), asset('new'));

    await service.updateSlot(
      'featured',
      { assetId: 'old', altText: 'Primera imagen' },
      4,
    );
    const result = await service.updateSlot(
      'featured',
      { assetId: 'new', altText: 'Imagen sustituta', focalX: 62, zoom: 1.5 },
      4,
    );

    expect(result.slot).toMatchObject({
      key: 'featured',
      focalX: 62,
      zoom: 1.5,
      asset: { id: 'new' },
    });
    expect((await service.getAssetLibrary()).assets).toHaveLength(2);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('reuses one asset in multiple slots with independent focal settings', async () => {
    assets.push(asset('shared'));

    await Promise.all([
      service.updateSlot('featured', {
        assetId: 'shared',
        altText: 'Encuadre vertical',
        focalX: 20,
        focalY: 30,
      }),
      service.updateSlot('slot-01', {
        assetId: 'shared',
        altText: 'Encuadre cuadrado',
        focalX: 80,
        focalY: 70,
        zoom: 2,
      }),
    ]);
    const result = await service.getPublicGallery();

    expect(result.slots[0]).toMatchObject({
      imageSrc: assets[0].publicUrl,
      focalX: 20,
      focalY: 30,
      zoom: 1,
    });
    expect(result.slots[1]).toMatchObject({
      imageSrc: assets[0].publicUrl,
      focalX: 80,
      focalY: 70,
      zoom: 2,
    });
    expect(assets).toHaveLength(1);
  });

  it('requires meaningful alt text and rejects unsafe Instagram URLs', async () => {
    assets.push(asset('photo'));

    await expect(
      service.updateSlot('slot-01', { assetId: 'photo', altText: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSlot('slot-01', {
        assetId: 'photo',
        altText: 'Foto de cliente',
        instagramUrl: 'https://instagram.evil.test/p/fake/',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps the database placeholder enum to the lowercase frontend contract', async () => {
    slots.push({
      key: 'featured',
      displayOrder: 0,
      featured: true,
      placeholderColor: GalleryPlaceholderColor.GREY,
      assetId: null,
      focalX: 50,
      focalY: 50,
      zoom: 1,
      altText: '',
      instagramUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect((await service.getPublicGallery()).slots[0].placeholderColor).toBe(
      'grey',
    );
  });

  it('atomically swaps complete photo content while position geometry stays fixed', async () => {
    assets.push(asset('featured-photo'), asset('numbered-photo'));
    await service.getAdminSlots();
    Object.assign(
      slots.find((slot) => slot.key === 'featured'),
      {
        assetId: 'featured-photo',
        altText: 'Foto destacada original',
        instagramUrl: 'https://www.instagram.com/p/featured/',
        focalX: 12,
        focalY: 34,
        zoom: 1.4,
      },
    );
    Object.assign(
      slots.find((slot) => slot.key === 'slot-05'),
      {
        assetId: 'numbered-photo',
        altText: 'Foto numerada original',
        instagramUrl: 'https://www.instagram.com/p/numbered/',
        focalX: 78,
        focalY: 66,
        zoom: 2.2,
      },
    );
    const assetSnapshot = assets.map((item) => ({ ...item }));

    const result = await service.reorderSlots(
      { sourceKey: 'featured', targetKey: 'slot-05' },
      17,
    );

    expect(result.operation).toBe('swap');
    expect(result.slots).toHaveLength(13);
    expect(result.slots.find((slot) => slot.key === 'featured')).toMatchObject({
      featured: true,
      displayOrder: 0,
      placeholderColor: 'grey',
      asset: { id: 'numbered-photo' },
      altText: 'Foto numerada original',
      instagramUrl: 'https://www.instagram.com/p/numbered/',
      focalX: 78,
      focalY: 66,
      zoom: 2.2,
    });
    expect(result.slots.find((slot) => slot.key === 'slot-05')).toMatchObject({
      featured: false,
      displayOrder: 5,
      placeholderColor: 'grey',
      asset: { id: 'featured-photo' },
      altText: 'Foto destacada original',
      instagramUrl: 'https://www.instagram.com/p/featured/',
      focalX: 12,
      focalY: 34,
      zoom: 1.4,
    });

    const reloaded = await service.getAdminSlots();
    const publicGallery = await service.getPublicGallery();
    expect(
      reloaded.slots.find((slot) => slot.key === 'featured')?.asset?.id,
    ).toBe('numbered-photo');
    expect(
      publicGallery.slots.find((slot) => slot.key === 'featured'),
    ).toMatchObject({
      imageSrc: assets[1].publicUrl,
      alt: 'Foto numerada original',
      focalX: 78,
      focalY: 66,
      zoom: 2.2,
    });
    expect(assets).toEqual(assetSnapshot);
    expect(storage.uploadGalleryImage).not.toHaveBeenCalled();
    expect(prisma.galleryAsset.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 17,
          action: 'gallery.slots.reorder',
          metadata: {
            sourceKey: 'featured',
            targetKey: 'slot-05',
            operation: 'swap',
          },
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('moves occupied content to an empty slot and clears every source field', async () => {
    assets.push(asset('moving-photo'));
    await service.getAdminSlots();
    Object.assign(
      slots.find((slot) => slot.key === 'slot-01'),
      {
        assetId: 'moving-photo',
        altText: 'Foto en movimiento',
        instagramUrl: 'https://www.instagram.com/p/moving/',
        focalX: 21,
        focalY: 82,
        zoom: 1.75,
      },
    );

    const result = await service.reorderSlots({
      sourceKey: 'slot-01',
      targetKey: 'slot-02',
    });

    expect(result.operation).toBe('move');
    expect(result.slots.find((slot) => slot.key === 'slot-01')).toMatchObject({
      asset: null,
      altText: '',
      instagramUrl: null,
      focalX: 50,
      focalY: 50,
      zoom: 1,
    });
    expect(result.slots.find((slot) => slot.key === 'slot-02')).toMatchObject({
      asset: { id: 'moving-photo' },
      altText: 'Foto en movimiento',
      instagramUrl: 'https://www.instagram.com/p/moving/',
      focalX: 21,
      focalY: 82,
      zoom: 1.75,
    });
  });

  it('rejects invalid, identical, and empty-source reorder requests', async () => {
    await expect(
      service.reorderSlots({ sourceKey: 'unknown', targetKey: 'slot-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reorderSlots({ sourceKey: 'slot-01', targetKey: 'slot-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reorderSlots({ sourceKey: 'slot-01', targetKey: 'slot-02' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gallerySlot.update).not.toHaveBeenCalled();
  });

  it('rolls back the first slot update when the second update fails', async () => {
    assets.push(asset('source-photo'), asset('target-photo'));
    await service.getAdminSlots();
    Object.assign(
      slots.find((slot) => slot.key === 'slot-03'),
      {
        assetId: 'source-photo',
        altText: 'Source metadata',
        focalX: 19,
        focalY: 29,
        zoom: 1.2,
      },
    );
    Object.assign(
      slots.find((slot) => slot.key === 'slot-04'),
      {
        assetId: 'target-photo',
        altText: 'Target metadata',
        focalX: 71,
        focalY: 81,
        zoom: 2.4,
      },
    );
    const previousSlots = slots.map((slot) => ({ ...slot }));
    const update = prisma.gallerySlot.update.getMockImplementation();
    let updateCount = 0;
    prisma.gallerySlot.update.mockImplementation(async (args: any) => {
      updateCount += 1;
      if (updateCount === 2) throw new Error('simulated second update failure');
      return update(args);
    });

    await expect(
      service.reorderSlots({ sourceKey: 'slot-03', targetKey: 'slot-04' }),
    ).rejects.toThrow('simulated second update failure');

    expect(slots).toEqual(previousSlots);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(storage.uploadGalleryImage).not.toHaveBeenCalled();
  });

  it('persists trimmed asset text and ordered active plus archived products', async () => {
    assets.push(asset('content-photo'));

    const result = await service.updateSlot('slot-01', {
      assetId: 'content-photo',
      altText: 'Editorial CRONOX',
      description: '  Primera l\u00ednea\nSegunda l\u00ednea  ',
      productIds: [2, 1, 2],
    });

    expect(assets[0].description).toBe(
      'Primera l\u00ednea\nSegunda l\u00ednea',
    );
    expect(assets[0].products.map((item: any) => item.productId)).toEqual([
      2, 1,
    ]);
    expect(result.slot.asset.products).toEqual([
      expect.objectContaining({ id: 2, available: false }),
      expect.objectContaining({ id: 1, available: true }),
    ]);

    const publicSlot = (await service.getPublicGallery()).slots[1];
    expect(publicSlot).toMatchObject({
      description: 'Primera l\u00ednea\nSegunda l\u00ednea',
      products: [
        {
          id: 2,
          slug: 'archive-tee',
          name: 'ARCHIVE TEE',
          price: 2995,
          currency: 'EUR',
          imageUrl: 'https://storage.example.test/archive.png',
          available: false,
        },
        expect.objectContaining({ id: 1, available: true }),
      ],
    });
    expect(publicSlot.products[0]).not.toHaveProperty('searchKeywords');
    expect(publicSlot.products[0]).not.toHaveProperty('variants');
  });

  it('rejects an unknown product and rolls back slot plus asset content', async () => {
    assets.push(asset('atomic-photo'));
    await service.getAdminSlots();

    await expect(
      service.updateSlot('slot-02', {
        assetId: 'atomic-photo',
        altText: 'Foto atomica',
        description: 'No debe persistir',
        productIds: [1, 999],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(assets[0]).toMatchObject({ description: null, products: [] });
    expect(slots.find((slot) => slot.key === 'slot-02')?.assetId).toBeNull();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('normalizes whitespace-only asset text to null', async () => {
    assets.push({ ...asset('blank-copy'), description: 'Texto anterior' });

    await service.updateSlot('slot-03', {
      assetId: 'blank-copy',
      altText: 'Foto con texto vacio',
      description: '  \n  ',
      productIds: [],
    });

    expect(assets[0].description).toBeNull();
    expect(assets[0].products).toEqual([]);
  });

  it('returns the same asset-owned content when one photo is reused or moved', async () => {
    assets.push(asset('shared-content'));
    await service.updateSlot('slot-04', {
      assetId: 'shared-content',
      altText: 'Primer uso',
      description: 'Contenido compartido',
      productIds: [1, 2],
    });
    await service.updateSlot('slot-05', {
      assetId: 'shared-content',
      altText: 'Segundo uso',
    });

    const beforeMove = await service.getAdminSlots();
    expect(
      beforeMove.slots[4].asset.products.map((item: any) => item.id),
    ).toEqual([1, 2]);
    expect(beforeMove.slots[5].asset.description).toBe('Contenido compartido');

    await service.reorderSlots({ sourceKey: 'slot-04', targetKey: 'slot-06' });
    const afterMove = await service.getAdminSlots();
    expect(afterMove.slots[6].asset).toMatchObject({
      id: 'shared-content',
      description: 'Contenido compartido',
      products: [
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 }),
      ],
    });
  });

  it('searches a deterministic protected repository including archived products', async () => {
    const result = await service.getProductRepository({
      search: 'tee',
      page: 1,
      limit: 20,
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 20,
      }),
    );
    expect(result.products).toEqual([
      expect.objectContaining({ id: 1, available: true }),
      expect.objectContaining({ id: 2, available: false }),
    ]);
  });
});
