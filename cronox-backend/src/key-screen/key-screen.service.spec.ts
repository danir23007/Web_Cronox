/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { KeyScreenMode, UserAccountState } from '@prisma/client';
import { KeyScreenService } from './key-screen.service';

describe('KeyScreenService', () => {
  let prisma: any;
  let email: any;
  let service: KeyScreenService;

  beforeEach(() => {
    prisma = {
      keyScreenSettings: {
        findUnique: jest.fn(),
        upsert: jest.fn(async () => ({
          id: 'global',
          enabled: false,
          activeScreenId: null,
        })),
        update: jest.fn(),
      },
      keyScreen: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      preRegistration: {
        create: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      websiteMediaAsset: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
    email = {
      isEnabled: jest.fn(() => false),
      sendPreRegistrationConfirmation: jest.fn(),
    };
    service = new KeyScreenService(prisma, {} as any, email);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the manual switch authoritative and expires at the exact UTC instant', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      expiresAt: new Date('2026-06-15T10:00:01.000Z'),
      activeScreen: {
        mode: KeyScreenMode.PREREGISTRATION,
        mediaAssetId: 'asset-1',
      },
    });

    await expect(service.shouldGatePublicHtml()).resolves.toBe(true);
    jest.setSystemTime(new Date('2026-06-15T10:00:00.999Z'));
    await expect(service.shouldGatePublicHtml()).resolves.toBe(true);
    jest.setSystemTime(new Date('2026-06-15T10:00:01.000Z'));
    await expect(service.shouldGatePublicHtml()).resolves.toBe(false);
    jest.setSystemTime(new Date('2026-06-15T10:00:01.001Z'));
    await expect(service.shouldGatePublicHtml()).resolves.toBe(false);

    service.invalidateGateCache();
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: false,
      expiresAt: new Date('2026-06-15T11:00:00.000Z'),
      activeScreen: {
        mode: KeyScreenMode.PREREGISTRATION,
        mediaAssetId: 'asset-1',
      },
    });
    await expect(service.shouldGatePublicHtml()).resolves.toBe(false);
  });

  it('persists or clears a future expiration and rejects invalid or past instants', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T11:00:00.000Z'));
    prisma.keyScreenSettings.update.mockImplementation(
      async ({ data }: any) => ({
        id: 'global',
        enabled: true,
        activeScreenId: 'screen-1',
        expiresAt: data.expiresAt,
      }),
    );

    await expect(
      service.setExpiration('2026-01-15T12:00:00.000Z', 7),
    ).resolves.toMatchObject({
      expiresAt: '2026-01-15T12:00:00.000Z',
      effectiveEnabled: true,
      serverTime: '2026-01-15T11:00:00.000Z',
    });
    expect(prisma.keyScreenSettings.update).toHaveBeenLastCalledWith({
      where: { id: 'global' },
      data: {
        expiresAt: new Date('2026-01-15T12:00:00.000Z'),
        updatedBy: 7,
      },
    });

    await expect(service.setExpiration(null, 7)).resolves.toMatchObject({
      expiresAt: null,
      effectiveEnabled: true,
    });
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      expiresAt: null,
      activeScreen: {
        mode: KeyScreenMode.PREREGISTRATION,
        mediaAssetId: 'asset-1',
      },
    });
    await expect(service.shouldGatePublicHtml()).resolves.toBe(true);
    await expect(service.setExpiration('not-a-date', 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.setExpiration('2026-01-15T12:00:00', 7),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setExpiration('2026-01-15T11:00:00.000Z', 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects preregistration at and after expiration', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T08:00:00.000Z'));
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      expiresAt: new Date('2026-07-01T08:00:00.000Z'),
      activeScreenId: 'screen-1',
      activeScreen: { mode: KeyScreenMode.PREREGISTRATION },
    });

    await expect(service.preregister('test@example.com')).rejects.toThrow(
      'Pantalla de preregistro no disponible',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('fails closed if the persistent gate state cannot be read', async () => {
    prisma.keyScreenSettings.findUnique.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(service.shouldGatePublicHtml()).resolves.toBe(true);
  });

  it('only gates with an enabled, usable PREREGISTRATION screen', async () => {
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      activeScreen: {
        mode: KeyScreenMode.PREREGISTRATION,
        mediaAssetId: 'asset-1',
      },
    });
    await expect(service.shouldGatePublicHtml()).resolves.toBe(true);
  });

  it('atomically selects one usable screen and protects the selected screen from deletion', async () => {
    prisma.keyScreen.findUnique.mockResolvedValue({
      id: 'screen-1',
      mode: KeyScreenMode.PREREGISTRATION,
      mediaAssetId: 'asset-1',
    });
    prisma.keyScreenSettings.upsert.mockResolvedValue({
      id: 'global',
      activeScreenId: 'screen-1',
      enabled: false,
    });
    await expect(service.activate('screen-1', 7)).resolves.toMatchObject({
      activeScreenId: 'screen-1',
    });
    expect(prisma.keyScreenSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ activeScreenId: 'screen-1' }),
      }),
    );
    prisma.keyScreenSettings.upsert.mockResolvedValue({
      id: 'global',
      activeScreenId: 'screen-1',
      enabled: false,
    });
    await expect(service.remove('screen-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not allow the future ACCESS mode to become live yet', async () => {
    prisma.keyScreen.findUnique.mockResolvedValue({
      id: 'screen-1',
      mode: KeyScreenMode.ACCESS,
      mediaAssetId: 'asset-1',
    });
    await expect(service.activate('screen-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('normalizes and creates one passwordless preregistered User without a session', async () => {
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      activeScreenId: 'screen-1',
      activeScreen: { mode: KeyScreenMode.PREREGISTRATION },
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 41 });
    await expect(service.preregister('  TEST@Example.COM ')).resolves.toEqual({
      ok: true,
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'test@example.com',
        password: null,
        accountState: UserAccountState.PRE_REGISTERED,
      },
      select: { id: true },
    });
    expect(prisma.preRegistration.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PRE_REGISTRATION_CREATED' }),
      }),
    );
  });

  it('rejects a duplicate preregistration with the requested message', async () => {
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      activeScreenId: 'screen-1',
      activeScreen: { mode: KeyScreenMode.PREREGISTRATION },
    });
    prisma.user.findFirst.mockResolvedValue({ id: 41 });
    await expect(service.preregister('test@example.com')).rejects.toThrow(
      'Este usuario ya está registrado.',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.preRegistration.create).not.toHaveBeenCalled();
  });

  it('detects an existing account case-insensitively and never changes its state', async () => {
    prisma.keyScreenSettings.findUnique.mockResolvedValue({
      enabled: true,
      activeScreenId: 'screen-1',
      activeScreen: { mode: KeyScreenMode.PREREGISTRATION },
    });
    prisma.user.findFirst.mockResolvedValue({ id: 9 });
    await expect(service.preregister('OWNER@example.com')).rejects.toThrow(
      'Este usuario ya está registrado.',
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'owner@example.com', mode: 'insensitive' },
      },
      select: { id: true },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.preRegistration.create).not.toHaveBeenCalled();
    expect(email.sendPreRegistrationConfirmation).not.toHaveBeenCalled();
  });

  it('claims confirmation delivery so concurrent retries cannot send twice', async () => {
    email.isEnabled.mockReturnValue(true);
    prisma.preRegistration.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.preRegistration.findUnique.mockResolvedValue({
      userId: 1,
      submittedAt: new Date('2026-09-10T12:00:00Z'),
      user: { email: 'test@example.com' },
    });
    email.sendPreRegistrationConfirmation.mockResolvedValue({
      messageId: 'one',
    });
    await (service as any).sendConfirmationOnce(1);
    await (service as any).sendConfirmationOnce(1);
    expect(email.sendPreRegistrationConfirmation).toHaveBeenCalledTimes(1);
    expect(prisma.preRegistration.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ confirmationSentAt: null }),
      }),
    );
  });

  it('publishes independent content layouts and falls back to legacy values', () => {
    const baseScreen = {
      mode: KeyScreenMode.PREREGISTRATION,
      desktopFocalX: 50,
      desktopFocalY: 50,
      desktopZoom: 1,
      desktopFit: 'COVER',
      mobileFocalX: 50,
      mobileFocalY: 50,
      mobileZoom: 1,
      mobileFit: 'COVER',
      title: 'Próximamente',
      subtitle: '',
      placeholder: 'Email',
      buttonText: 'Enviar',
      successTitle: 'Listo',
      successMessage: 'Gracias',
      privacyLabel: 'Privacidad',
      textColor: '#ffffff',
      inputStyle: 'LIGHT',
      buttonStyle: 'DARK',
      horizontalAlign: 'CENTER',
      verticalAlign: 'BOTTOM',
      offsetX: 8,
      offsetY: -12,
      overlayStrength: 25,
      mediaAsset: {
        publicUrl: 'https://storage.example.test/prelaunch.png',
        mediaType: 'image',
        width: 1600,
        height: 900,
      },
    };
    expect((service as any).toPublicScreen(baseScreen)).toMatchObject({
      desktopHorizontalAlign: 'CENTER',
      desktopVerticalAlign: 'BOTTOM',
      desktopOffsetX: 8,
      desktopOffsetY: -12,
      mobileHorizontalAlign: 'CENTER',
      mobileVerticalAlign: 'BOTTOM',
      mobileOffsetX: 8,
      mobileOffsetY: -12,
    });
    expect(
      (service as any).toPublicScreen({
        ...baseScreen,
        desktopHorizontalAlign: 'LEFT',
        desktopOffsetX: 20,
        mobileHorizontalAlign: 'RIGHT',
        mobileOffsetX: -20,
      }),
    ).toMatchObject({
      desktopHorizontalAlign: 'LEFT',
      desktopOffsetX: 20,
      mobileHorizontalAlign: 'RIGHT',
      mobileOffsetX: -20,
    });
  });

  it('persists and reloads independent desktop and mobile content positions', async () => {
    prisma.keyScreen.updateMany.mockResolvedValue({ count: 1 });
    prisma.keyScreen.findUnique.mockResolvedValueOnce({
      id: 'screen-1',
      revision: 4,
      desktopHorizontalAlign: 'LEFT',
      desktopVerticalAlign: 'TOP',
      desktopOffsetX: 30,
      desktopOffsetY: 40,
      mobileHorizontalAlign: 'RIGHT',
      mobileVerticalAlign: 'BOTTOM',
      mobileOffsetX: -15,
      mobileOffsetY: -25,
      desktopFormOffsetX: 5,
      desktopFormOffsetY: 10,
      desktopPrivacyOffsetX: 15,
      desktopPrivacyOffsetY: -20,
      mobileFormOffsetX: -5,
      mobileFormOffsetY: -10,
      mobilePrivacyOffsetX: -15,
      mobilePrivacyOffsetY: -30,
    });

    await expect(
      service.update('screen-1', {
        expectedRevision: 3,
        desktopHorizontalAlign: 'LEFT' as any,
        desktopVerticalAlign: 'TOP' as any,
        desktopOffsetX: 30,
        desktopOffsetY: 40,
        mobileHorizontalAlign: 'RIGHT' as any,
        mobileVerticalAlign: 'BOTTOM' as any,
        mobileOffsetX: -15,
        mobileOffsetY: -25,
        desktopFormOffsetX: 5,
        desktopFormOffsetY: 10,
        desktopPrivacyOffsetX: 15,
        desktopPrivacyOffsetY: -20,
        mobileFormOffsetX: -5,
        mobileFormOffsetY: -10,
        mobilePrivacyOffsetX: -15,
        mobilePrivacyOffsetY: -30,
      }),
    ).resolves.toMatchObject({
      desktopOffsetX: 30,
      mobileOffsetX: -15,
      desktopFormOffsetY: 10,
      mobilePrivacyOffsetY: -30,
    });
    expect(prisma.keyScreen.updateMany).toHaveBeenCalledWith({
      where: { id: 'screen-1', revision: 3 },
      data: expect.objectContaining({
        desktopHorizontalAlign: 'LEFT',
        desktopOffsetX: 30,
        mobileHorizontalAlign: 'RIGHT',
        mobileOffsetX: -15,
        desktopFormOffsetY: 10,
        mobilePrivacyOffsetY: -30,
        revision: { increment: 1 },
      }),
    });
  });
});
