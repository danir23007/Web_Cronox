import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { KeyScreenMode, Prisma, UserAccountState } from '@prisma/client';
import type { Express } from 'express';
import { normalizeEmail } from '../common/email';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKeyScreenDto, UpdateKeyScreenDto } from './dto/key-screen.dto';

const GLOBAL_ID = 'global';
const CONFIRMATION_CLAIM_STALE_MS = 10 * 60 * 1000;
const ALREADY_REGISTERED_MESSAGE = 'Este usuario ya está registrado.';
type PublicKeyScreen = Prisma.KeyScreenGetPayload<{
  include: { mediaAsset: true };
}>;

@Injectable()
export class KeyScreenService {
  private readonly logger = new Logger(KeyScreenService.name);
  private cachedGate: {
    enabled: boolean;
    expirationMs: number | null;
    validUntilMs: number;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly email: EmailService,
  ) {}

  invalidateGateCache() {
    this.cachedGate = null;
  }

  async shouldGatePublicHtml(): Promise<boolean> {
    const now = Date.now();
    if (this.cachedGate && this.cachedGate.validUntilMs > now) {
      return this.cachedGate.enabled;
    }
    try {
      const settings = await this.prisma.keyScreenSettings.findUnique({
        where: { id: GLOBAL_ID },
        include: {
          activeScreen: { select: { mode: true, mediaAssetId: true } },
        },
      });
      const expirationMs = settings?.expiresAt?.getTime() ?? null;
      const enabled = Boolean(
        settings?.enabled &&
          (expirationMs === null || now < expirationMs) &&
          settings.activeScreen?.mode === KeyScreenMode.PREREGISTRATION &&
          settings.activeScreen.mediaAssetId,
      );
      this.cachedGate = {
        enabled,
        expirationMs,
        validUntilMs:
          expirationMs !== null && expirationMs > now
            ? Math.min(now + 1_000, expirationMs)
            : now + 1_000,
      };
      return enabled;
    } catch {
      this.logger.error('No se pudo comprobar el estado de Pantalla Clave');
      if (!this.cachedGate) return true;
      return Boolean(
        this.cachedGate.enabled &&
          (this.cachedGate.expirationMs === null ||
            now < this.cachedGate.expirationMs),
      );
    }
  }

  async adminState() {
    const [settings, screens, preregisteredCount, assets] = await Promise.all([
      this.ensureSettings(),
      this.prisma.keyScreen.findMany({
        include: { mediaAsset: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.preRegistration.count(),
      this.prisma.websiteMediaAsset.findMany({
        where: { folderKey: 'pantalla-clave' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      settings: this.toAdminSettings(settings),
      screens,
      preregisteredCount,
      assets,
    };
  }

  async publicState() {
    try {
      const now = new Date();
      const settings = await this.prisma.keyScreenSettings.findUnique({
        where: { id: GLOBAL_ID },
        include: { activeScreen: { include: { mediaAsset: true } } },
      });
      const screen = settings?.activeScreen;
      const timing = {
        serverTime: now.toISOString(),
        expiresAt: settings?.expiresAt?.toISOString() ?? null,
      };
      if (!this.isEffectivelyEnabled(settings, now)) {
        return { enabled: false, ...timing };
      }
      if (!screen) {
        this.logger.error(
          'Pantalla Clave está activa, pero activeScreenId no resuelve una pantalla.',
        );
        return {
          enabled: true,
          ...timing,
          screen: null,
          diagnostic: 'ACTIVE_SCREEN_MISSING',
        };
      }
      if (!screen.mediaAsset) {
        this.logger.error(
          `Pantalla Clave está activa, pero la pantalla ${screen.id} no resuelve su multimedia.`,
        );
        return {
          enabled: true,
          ...timing,
          screen: null,
          diagnostic: 'MEDIA_ASSET_MISSING',
        };
      }
      return {
        enabled: true,
        ...timing,
        screen: this.toPublicScreen(screen),
      };
    } catch (error) {
      this.logger.error(
        'La API pública no pudo cargar la configuración persistida de Pantalla Clave.',
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async create(dto: CreateKeyScreenDto, adminId?: number) {
    return this.prisma.keyScreen.create({
      data: {
        internalName: dto.internalName,
        createdBy: adminId,
        updatedBy: adminId,
      },
      include: { mediaAsset: true },
    });
  }

  async update(id: string, dto: UpdateKeyScreenDto, adminId?: number) {
    const { expectedRevision, ...data } = dto;
    if (data.mediaAssetId) await this.assertKeyScreenAsset(data.mediaAssetId);
    const updated = await this.prisma.keyScreen.updateMany({
      where: { id, revision: expectedRevision },
      data: { ...data, updatedBy: adminId, revision: { increment: 1 } },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.keyScreen.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Pantalla no encontrada');
      throw new ConflictException(
        'La pantalla cambió en otra sesión. Recarga antes de guardar.',
      );
    }
    this.invalidateGateCache();
    return this.prisma.keyScreen.findUnique({
      where: { id },
      include: { mediaAsset: true },
    });
  }

  async activate(screenId: string, adminId?: number) {
    const screen = await this.prisma.keyScreen.findUnique({
      where: { id: screenId },
    });
    if (!screen) throw new NotFoundException('Pantalla no encontrada');
    if (!screen.mediaAssetId)
      throw new BadRequestException(
        'Selecciona una imagen o vídeo antes de activar.',
      );
    if (screen.mode !== KeyScreenMode.PREREGISTRATION) {
      throw new BadRequestException(
        'El modo ACCESO está preparado para una fase futura y todavía no puede activarse.',
      );
    }
    const settings = await this.prisma.keyScreenSettings.upsert({
      where: { id: GLOBAL_ID },
      create: {
        id: GLOBAL_ID,
        enabled: false,
        activeScreenId: screenId,
        updatedBy: adminId,
      },
      update: { activeScreenId: screenId, updatedBy: adminId },
    });
    this.invalidateGateCache();
    return this.toAdminSettings(settings);
  }

  async setEnabled(enabled: boolean, adminId?: number) {
    const current = await this.ensureSettings();
    if (enabled) {
      const screen = current.activeScreenId
        ? await this.prisma.keyScreen.findUnique({
            where: { id: current.activeScreenId },
          })
        : null;
      if (
        !screen?.mediaAssetId ||
        screen.mode !== KeyScreenMode.PREREGISTRATION
      ) {
        throw new BadRequestException(
          'Activa primero una pantalla de PRERREGISTRO con multimedia válida.',
        );
      }
    }
    if (!enabled) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = await this.prisma.keyScreenSettings.findUnique({ where: { id: GLOBAL_ID } });
        if (!latest?.enabled) {
          this.invalidateGateCache();
          return this.toAdminSettings(latest || current);
        }
        const armed = latest.launchStatus === 'ARMED';
        const updated = await this.prisma.keyScreenSettings.updateMany({
          where: { id: GLOBAL_ID, enabled: true, launchStatus: latest.launchStatus },
          data: { enabled: false, updatedBy: adminId,
            ...(armed ? { launchStatus: 'SENDING', launchStartedAt: new Date(), launchTrigger: 'MANUAL' } : {}) },
        });
        if (updated.count === 1) {
          const settings = await this.prisma.keyScreenSettings.findUniqueOrThrow({ where: { id: GLOBAL_ID } });
          this.invalidateGateCache();
          return this.toAdminSettings(settings);
        }
      }
      throw new ConflictException('La pantalla cambió. Recarga antes de desactivarla.');
    }
    const settings = await this.prisma.keyScreenSettings.update({
      where: { id: GLOBAL_ID }, data: { enabled, updatedBy: adminId },
    });
    this.invalidateGateCache();
    return this.toAdminSettings(settings);
  }

  async setExpiration(expiresAt: string | null, adminId?: number) {
    let parsed: Date | null = null;
    if (expiresAt !== null) {
      if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)) {
        throw new BadRequestException(
          'La fecha debe incluir una zona horaria explícita.',
        );
      }
      parsed = new Date(expiresAt);
      if (!Number.isFinite(parsed.getTime())) {
        throw new BadRequestException(
          'La fecha de desactivación no es válida.',
        );
      }
      if (parsed.getTime() <= Date.now()) {
        throw new BadRequestException(
          'La fecha debe estar en el futuro. Para desactivar ahora, usa el interruptor principal.',
        );
      }
    }
    await this.ensureSettings();
    const settings = await this.prisma.keyScreenSettings.update({
      where: { id: GLOBAL_ID },
      data: { expiresAt: parsed, updatedBy: adminId },
    });
    this.invalidateGateCache();
    return this.toAdminSettings(settings);
  }

  async remove(id: string) {
    const settings = await this.ensureSettings();
    if (settings.activeScreenId === id) {
      throw new ConflictException(
        'No puedes eliminar la pantalla seleccionada. Selecciona otra primero.',
      );
    }
    await this.prisma.keyScreen
      .delete({ where: { id } })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException('Pantalla no encontrada');
        }
        throw error;
      });
    return { ok: true };
  }

  async upload(file: Express.Multer.File | undefined, adminId?: number) {
    const uploaded = await this.storage.uploadWebsiteMedia(
      file,
      'pantalla-clave',
      adminId,
    );
    return this.prisma.websiteMediaAsset.create({ data: uploaded });
  }

  async preregister(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    let userId: number;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const active = await tx.keyScreenSettings.findUnique({
          where: { id: GLOBAL_ID },
          include: { activeScreen: true },
        });
        if (
          !active ||
          !this.isEffectivelyEnabled(active) ||
          active.activeScreen?.mode !== KeyScreenMode.PREREGISTRATION
        ) {
          throw new NotFoundException('Pantalla de preregistro no disponible');
        }
        const existing = await tx.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException(ALREADY_REGISTERED_MESSAGE);
        }
        const user = await tx.user.create({
          data: {
            email,
            password: null,
            accountState: UserAccountState.PRE_REGISTERED,
          },
          select: { id: true },
        });
        await tx.preRegistration.create({
          data: { userId: user.id, screenId: active.activeScreenId },
        });
        await tx.auditLog.create({
          data: {
            action: 'PRE_REGISTRATION_CREATED',
            actionType: 'CREATE',
            targetType: 'USER',
            targetId: String(user.id),
            metadata: { source: 'PANTALLA_CLAVE' },
          },
        });
        return user.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) throw new ConflictException(ALREADY_REGISTERED_MESSAGE);
        throw error;
      } else throw error;
    }
    void this.sendConfirmationOnce(userId).catch(() =>
      this.logger.error('Falló la confirmación de un preregistro'),
    );
    return { ok: true };
  }

  private async sendConfirmationOnce(userId: number) {
    if (!this.email.isEnabled()) return;
    const claim = await this.prisma.preRegistration.updateMany({
      where: {
        userId,
        confirmationSentAt: null,
        OR: [
          { confirmationClaimedAt: null },
          {
            confirmationClaimedAt: {
              lt: new Date(Date.now() - CONFIRMATION_CLAIM_STALE_MS),
            },
          },
        ],
      },
      data: { confirmationClaimedAt: new Date() },
    });
    if (claim.count !== 1) return;
    const registration = await this.prisma.preRegistration.findUnique({
      where: { userId },
      include: { user: { select: { email: true } } },
    });
    if (!registration) return;
    try {
      await this.email.sendPreRegistrationConfirmation(
        registration.user.email,
        registration.submittedAt,
      );
      await this.prisma.preRegistration.updateMany({
        where: { userId, confirmationSentAt: null },
        data: { confirmationSentAt: new Date(), confirmationClaimedAt: null },
      });
    } catch (error) {
      await this.prisma.preRegistration.updateMany({
        where: { userId, confirmationSentAt: null },
        data: { confirmationClaimedAt: null },
      });
      throw error;
    }
  }

  private ensureSettings() {
    return this.prisma.keyScreenSettings.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID },
      update: {},
    });
  }

  private isEffectivelyEnabled(
    settings: { enabled?: boolean; expiresAt?: Date | null } | null | undefined,
    now = new Date(),
  ) {
    return Boolean(
      settings?.enabled &&
        (!settings.expiresAt || settings.expiresAt.getTime() > now.getTime()),
    );
  }

  private toAdminSettings(settings: {
    enabled: boolean;
    expiresAt?: Date | null;
    [key: string]: unknown;
  }) {
    const now = new Date();
    return {
      ...settings,
      expiresAt: settings.expiresAt?.toISOString() ?? null,
      effectiveEnabled: this.isEffectivelyEnabled(settings, now),
      serverTime: now.toISOString(),
    };
  }

  private async assertKeyScreenAsset(id: string) {
    const asset = await this.prisma.websiteMediaAsset.findUnique({
      where: { id },
    });
    if (!asset || asset.folderKey !== 'pantalla-clave') {
      throw new BadRequestException(
        'El archivo no pertenece a Pantalla Clave.',
      );
    }
  }

  private toPublicScreen(screen: PublicKeyScreen) {
    const { mediaAsset } = screen;
    if (!mediaAsset) {
      throw new Error('La pantalla pública no tiene multimedia asociada.');
    }
    return {
      mode: screen.mode,
      desktopFocalX: screen.desktopFocalX,
      desktopFocalY: screen.desktopFocalY,
      desktopZoom: screen.desktopZoom,
      desktopFit: screen.desktopFit,
      mobileFocalX: screen.mobileFocalX,
      mobileFocalY: screen.mobileFocalY,
      mobileZoom: screen.mobileZoom,
      mobileFit: screen.mobileFit,
      title: screen.title,
      subtitle: screen.subtitle,
      placeholder: screen.placeholder,
      buttonText: screen.buttonText,
      successTitle: screen.successTitle,
      successMessage: screen.successMessage,
      privacyLabel: screen.privacyLabel,
      textColor: screen.textColor,
      inputStyle: screen.inputStyle,
      buttonStyle: screen.buttonStyle,
      horizontalAlign: screen.horizontalAlign,
      verticalAlign: screen.verticalAlign,
      offsetX: screen.offsetX,
      offsetY: screen.offsetY,
      desktopHorizontalAlign:
        screen.desktopHorizontalAlign ?? screen.horizontalAlign,
      desktopVerticalAlign: screen.desktopVerticalAlign ?? screen.verticalAlign,
      desktopOffsetX: screen.desktopOffsetX ?? screen.offsetX,
      desktopOffsetY: screen.desktopOffsetY ?? screen.offsetY,
      mobileHorizontalAlign:
        screen.mobileHorizontalAlign ?? screen.horizontalAlign,
      mobileVerticalAlign: screen.mobileVerticalAlign ?? screen.verticalAlign,
      mobileOffsetX: screen.mobileOffsetX ?? screen.offsetX,
      mobileOffsetY: screen.mobileOffsetY ?? screen.offsetY,
      desktopFormOffsetX: screen.desktopFormOffsetX ?? 0,
      desktopFormOffsetY: screen.desktopFormOffsetY ?? 0,
      desktopPrivacyOffsetX: screen.desktopPrivacyOffsetX ?? 0,
      desktopPrivacyOffsetY: screen.desktopPrivacyOffsetY ?? 0,
      mobileFormOffsetX: screen.mobileFormOffsetX ?? 0,
      mobileFormOffsetY: screen.mobileFormOffsetY ?? 0,
      mobilePrivacyOffsetX: screen.mobilePrivacyOffsetX ?? 0,
      mobilePrivacyOffsetY: screen.mobilePrivacyOffsetY ?? 0,
      overlayStrength: screen.overlayStrength,
      media: {
        source: mediaAsset.publicUrl,
        mediaType: mediaAsset.mediaType,
        width: mediaAsset.width,
        height: mediaAsset.height,
      },
      privacyUrl: '/privacidad',
    };
  }
}
