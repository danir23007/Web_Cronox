/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { GalleryPlaceholderColor } from '@prisma/client';
import { GalleryService } from './gallery.service';

describe('GalleryService', () => {
  let slots: any[];
  let assets: any[];
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
    createdAt,
  });

  const withAsset = (slot: any) => ({
    ...slot,
    asset: assets.find((item) => item.id === slot.assetId) || null,
  });

  beforeEach(() => {
    slots = [];
    assets = [];
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
        slots[index] = {
          ...slots[index],
          ...data,
          updatedAt: new Date('2026-08-14T11:00:00Z'),
        };
        return withAsset(slots[index]);
      }),
    };
    const galleryAsset = {
      findMany: jest.fn(async () => [...assets].reverse()),
      findUnique: jest.fn(async ({ where }: any) => {
        const found = assets.find((item) => item.id === where.id);
        return found ? { id: found.id } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = {
          id: `asset-${assets.length + 1}`,
          createdAt: new Date('2026-08-14T10:00:00Z'),
          ...data,
        };
        assets.push(created);
        return created;
      }),
    };
    const auditLog = { create: jest.fn(async () => ({})) };
    prisma = {
      gallerySlot,
      galleryAsset,
      auditLog,
      $transaction: jest.fn(async (callback: any) =>
        callback({ gallerySlot, galleryAsset, auditLog }),
      ),
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
});
