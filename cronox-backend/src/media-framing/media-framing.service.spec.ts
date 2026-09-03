/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MediaFitMode } from '@prisma/client';
import { MediaFramingService } from './media-framing.service';

describe('MediaFramingService', () => {
  let websiteRecords: any[];
  let mediaAssets: any[];
  let audits: any[];
  let prisma: any;
  let service: MediaFramingService;

  beforeEach(() => {
    websiteRecords = [];
    mediaAssets = [];
    audits = [];
    const websiteMediaPlacement = {
      findMany: jest.fn(async ({ where, include }: any) =>
        websiteRecords
          .filter((record) => where.key.in.includes(record.key))
          .map((record) =>
            include?.asset
              ? {
                  ...record,
                  asset:
                    mediaAssets.find((asset) => asset.id === record.assetId) ||
                    null,
                }
              : record,
          ),
      ),
      findUnique: jest.fn(
        async ({ where }: any) =>
          websiteRecords.find((record) => record.key === where.key) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const record = {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        websiteRecords.push(record);
        return record;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const record = websiteRecords.find(
          (item) => item.key === where.key && item.revision === where.revision,
        );
        if (!record) return { count: 0 };
        Object.assign(record, data, {
          revision: record.revision + 1,
          updatedAt: new Date(),
        });
        return { count: 1 };
      }),
    };
    prisma = {
      websiteMediaPlacement,
      websiteMediaAsset: {
        findMany: jest.fn(async () => mediaAssets),
        findUnique: jest.fn(
          async ({ where }: any) =>
            mediaAssets.find((asset) => asset.id === where.id) || null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const asset = {
            id: `asset-${mediaAssets.length + 1}`,
            ...data,
            createdAt: new Date(),
          };
          mediaAssets.push(asset);
          return asset;
        }),
      },
      auditLog: { create: jest.fn(async ({ data }: any) => audits.push(data)) },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
    const storage = {
      uploadWebsiteMedia: jest.fn(async () => ({
        storageKey: 'multimedia-web/portadas/fotos/asset.jpg',
        publicUrl: 'https://storage.example.test/asset.jpg',
        originalFilename: 'portada.jpg',
        mimeType: 'image/jpeg',
        mediaType: 'image',
        folderKey: 'portadas',
        fileSize: 1024,
        width: 1600,
        height: 900,
      })),
    };
    service = new MediaFramingService(prisma, storage as any);
  });

  it('returns only genuine structural website media with safe defaults', async () => {
    const publicResponse = await service.getPublicFraming();
    const adminResponse = await service.getAdminPlacements();

    expect(Object.keys(publicResponse.placements)).toEqual(['home.hero.video']);
    expect(publicResponse.placements['home.hero.video']).toEqual({
      desktop: { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' },
      tablet: null,
      mobile: null,
      source: '/assets/VIDEO_LOGO_CRONOX.mp4',
      mediaType: 'video',
      poster: '/assets/logo_banner.png',
    });
    expect(adminResponse.placements).toHaveLength(1);
    expect(adminResponse.placements[0]).toMatchObject({
      key: 'home.hero.video',
      authority: 'static',
      source: '/assets/VIDEO_LOGO_CRONOX.mp4',
      preview: {
        kind: 'viewport',
        tablet: { width: 768, height: 1024 },
        mobile: { width: 390, height: 844 },
      },
    });
    expect(JSON.stringify(publicResponse)).not.toContain('storageKey');
  });

  it('persists responsive hero overrides atomically and writes an audit log', async () => {
    const result = await service.updatePlacement(
      'home.hero.video',
      {
        desktop: {
          focalX: 40,
          focalY: 55,
          zoom: 1.25,
          fit: MediaFitMode.COVER,
        },
        tablet: { focalX: 45, focalY: 60, zoom: 1.5, fit: MediaFitMode.COVER },
        mobile: { focalX: 65, focalY: 70, zoom: 2, fit: MediaFitMode.CONTAIN },
        expectedRevision: 0,
      },
      12,
    );

    expect(websiteRecords[0]).toMatchObject({
      key: 'home.hero.video',
      tabletFocalX: 45,
      mobileFocalX: 65,
      revision: 1,
    });
    expect(result.placement.status).toBe('RESPONSIVE_CUSTOM');
    expect(audits[0]).toMatchObject({
      actorId: 12,
      action: 'media.framing.update',
      targetId: 'home.hero.video',
    });
  });

  it('resets the hero to the verified cover/center/no-zoom baseline', async () => {
    await service.updatePlacement(
      'home.hero.video',
      {
        desktop: { focalX: 5, focalY: 95, zoom: 2, fit: MediaFitMode.CONTAIN },
        tablet: null,
        mobile: null,
        expectedRevision: 0,
      },
      2,
    );
    const result = await service.resetPlacement(
      'home.hero.video',
      { expectedRevision: 1 },
      2,
    );

    expect(result.placement.framing).toEqual({
      desktop: { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' },
      tablet: null,
      mobile: null,
    });
    expect(result.placement.status).toBe('DEFAULT');
    expect(audits.at(-1)?.action).toBe('media.framing.reset');
  });

  it('keeps uploaded media in PORTADAS/Fotos and can reuse it non-destructively', async () => {
    const upload = await service.uploadAsset(
      'home.hero.video',
      {} as Express.Multer.File,
      7,
    );
    expect(upload.asset).toMatchObject({
      id: 'asset-1',
      folderKey: 'portadas',
      mediaType: 'image',
      originalFilename: 'portada.jpg',
    });

    const before = await service.getAssetLibrary();
    expect(before.folders[0]).toMatchObject({
      key: 'portadas',
      label: 'PORTADAS',
      placementKeys: ['home.hero.video'],
    });
    expect(before.folders[0].photos).toHaveLength(1);
    expect(before.folders[0].videos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'builtin:home.hero.video',
          poster: '/assets/logo_banner.png',
          builtin: true,
        }),
      ]),
    );

    const selected = await service.selectAsset(
      'home.hero.video',
      { assetId: 'asset-1', expectedRevision: 0 },
      7,
    );
    expect(selected.placement).toMatchObject({
      activeAssetId: 'asset-1',
      mediaType: 'image',
      source: 'https://storage.example.test/asset.jpg',
      sourceFilename: 'portada.jpg',
      revision: 1,
    });
    expect(mediaAssets).toHaveLength(1);
    expect(audits.map((entry) => entry.action)).toEqual([
      'media.asset.upload',
      'media.asset.select',
    ]);

    const restored = await service.selectAsset(
      'home.hero.video',
      { assetId: null, expectedRevision: 1 },
      7,
    );
    expect(restored.placement).toMatchObject({
      activeAssetId: null,
      mediaType: 'video',
      source: '/assets/VIDEO_LOGO_CRONOX.mp4',
    });
    expect(mediaAssets).toHaveLength(1);
  });

  it.each([
    'store.product.card',
    'search.product.suggestion',
    'cart.product.thumbnail',
    'checkout.product.thumbnail',
    'product.recommendation.card',
    'gallery.featured',
    'gallery.slot-01',
    'body.script.inject',
  ])('rejects excluded or unknown placement %s', async (key) => {
    await expect(service.getAdminPlacement(key)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects stale concurrent writes without an audit entry', async () => {
    websiteRecords.push({
      key: 'home.hero.video',
      focalX: 50,
      focalY: 50,
      zoom: 1,
      fit: MediaFitMode.COVER,
      tabletFocalX: null,
      tabletFocalY: null,
      tabletZoom: null,
      tabletFit: null,
      mobileFocalX: null,
      mobileFocalY: null,
      mobileZoom: null,
      mobileFit: null,
      revision: 4,
      updatedAt: new Date(),
    });

    await expect(
      service.updatePlacement(
        'home.hero.video',
        {
          desktop: { focalX: 50, focalY: 50, zoom: 1, fit: MediaFitMode.COVER },
          expectedRevision: 3,
        },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audits).toHaveLength(0);
  });
});
