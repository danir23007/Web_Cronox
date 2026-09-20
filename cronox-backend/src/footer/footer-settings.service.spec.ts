import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FOOTER_DEFAULTS,
  FooterSettingsService,
} from './footer-settings.service';

describe('FooterSettingsService', () => {
  const payload = { ...FOOTER_DEFAULTS, expectedRevision: 0 };

  const setup = () => {
    const tx = {
      footerSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'global' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      footerSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    return {
      tx,
      prisma,
      service: new FooterSettingsService(prisma as never),
    };
  };

  it('returns complete public defaults with the canonical Instagram URL', async () => {
    const { service } = setup();
    await expect(service.getPublicSettings()).resolves.toEqual({
      version: 1,
      ...FOOTER_DEFAULTS,
    });
  });

  it('falls back only when the unapplied FooterSettings table is missing', async () => {
    const { service, prisma } = setup();
    prisma.footerSettings.findUnique.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing table', {
        code: 'P2021',
        clientVersion: '6.19.3',
      }),
    );
    await expect(service.getPublicSettings()).resolves.toEqual({
      version: 1,
      ...FOOTER_DEFAULTS,
    });

    prisma.footerSettings.findUnique.mockRejectedValue(new Error('network'));
    await expect(service.getPublicSettings()).rejects.toThrow('network');
  });

  it('persists one revision and one audit event atomically', async () => {
    const { service, tx } = setup();
    await service.update(payload, 17);
    expect(tx.footerSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'global',
        instagramUrl: 'https://www.instagram.com/cronox.es/',
        revision: 1,
        updatedBy: 17,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 17,
        action: 'footer.settings.update',
        targetType: 'footer-settings',
      }),
    });
  });

  it('rejects unsafe social URLs and stale revisions', async () => {
    const unsafe = setup();
    await expect(
      unsafe.service.update(
        { ...payload, instagramUrl: 'javascript:alert(1)' },
        17,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const credentials = setup();
    await expect(
      credentials.service.update(
        { ...payload, instagramUrl: 'https://user:pass@example.com/' },
        17,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const stale = setup();
    stale.tx.footerSettings.findUnique.mockResolvedValue({ revision: 2 });
    await expect(stale.service.update(payload, 17)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
