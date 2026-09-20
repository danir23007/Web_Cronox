import { ConflictException, NotFoundException } from '@nestjs/common';
import { MediaFitMode } from '@prisma/client';
import { NewsletterSettingsService } from './newsletter-settings.service';

describe('NewsletterSettingsService', () => {
  const frame = { focalX: 50, focalY: 50, zoom: 1, fit: MediaFitMode.COVER };
  const payload = {
    mediaAssetId: 'asset-1',
    desktop: { ...frame, focalX: 30 },
    mobile: { ...frame, focalY: 70, zoom: 1.5 },
    asciiEnabled: false,
    asciiOpacity: 0.45,
    expectedRevision: 0,
  };

  const setup = () => {
    const tx = {
      newsletterSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'global' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      websiteMediaAsset: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'asset-1',
          mediaType: 'image',
        }),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      newsletterSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      websiteMediaAsset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const storage = { uploadWebsiteMedia: jest.fn() };
    return {
      tx,
      prisma,
      storage,
      service: new NewsletterSettingsService(prisma as never, storage as never),
    };
  };

  it('returns safe defaults when no settings row exists', async () => {
    const { service } = setup();
    await expect(service.getPublicSettings()).resolves.toEqual({
      version: 1,
      source: null,
      variants: null,
      desktop: frame,
      mobile: frame,
      asciiEnabled: true,
      asciiOpacity: 1,
    });
  });

  it('projects configured media and framing without Admin-only fields', async () => {
    const { service, prisma } = setup();
    prisma.newsletterSettings.findUnique.mockResolvedValue({
      id: 'global',
      mediaAssetId: 'asset-1',
      mediaAsset: {
        publicUrl: 'https://example.test/newsletter.webp',
        variants: { mobile: { url: 'https://example.test/mobile.webp' } },
      },
      desktopFocalX: 20,
      desktopFocalY: 30,
      desktopZoom: 1.2,
      desktopFit: MediaFitMode.COVER,
      mobileFocalX: 70,
      mobileFocalY: 80,
      mobileZoom: 1.8,
      mobileFit: MediaFitMode.CONTAIN,
      asciiEnabled: true,
      asciiOpacity: 0.6,
      revision: 9,
      updatedAt: new Date(),
    });
    const result = await service.getPublicSettings();
    expect(result).toEqual(
      expect.objectContaining({
        source: 'https://example.test/newsletter.webp',
        desktop: { focalX: 20, focalY: 30, zoom: 1.2, fit: 'COVER' },
        mobile: { focalX: 70, focalY: 80, zoom: 1.8, fit: 'CONTAIN' },
        asciiEnabled: true,
        asciiOpacity: 0.6,
      }),
    );
    expect(result).not.toHaveProperty('mediaAssetId');
    expect(result).not.toHaveProperty('revision');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('atomically validates the image, saves all settings and writes one audit row', async () => {
    const { service, tx } = setup();
    await service.update(payload, 7);
    expect(tx.websiteMediaAsset.findUnique).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
    });
    expect(tx.newsletterSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'global',
        mediaAssetId: 'asset-1',
        desktopFocalX: 30,
        mobileFocalY: 70,
        mobileZoom: 1.5,
        asciiEnabled: false,
        asciiOpacity: 0.45,
        revision: 1,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects missing/non-image assets and stale revisions', async () => {
    const missing = setup();
    missing.tx.websiteMediaAsset.findUnique.mockResolvedValue(null);
    await expect(missing.service.update(payload, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const stale = setup();
    stale.tx.newsletterSettings.findUnique.mockResolvedValue({ revision: 2 });
    await expect(stale.service.update(payload, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
