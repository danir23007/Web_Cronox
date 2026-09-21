import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaFitMode, Prisma } from '@prisma/client';
import type { Express } from 'express';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNewsletterSettingsDto } from './dto/newsletter-settings.dto';

const SETTINGS_ID = 'global';
const DEFAULT_FRAME = Object.freeze({
  focalX: 50,
  focalY: 50,
  zoom: 1,
  fit: MediaFitMode.COVER,
});

type SettingsWithAsset = Prisma.NewsletterSettingsGetPayload<{
  include: { mediaAsset: true };
}>;

@Injectable()
export class NewsletterSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  private serialize(record: SettingsWithAsset | null) {
    return {
      mediaAssetId: record?.mediaAssetId ?? null,
      source: record?.mediaAsset?.publicUrl ?? null,
      variants: record?.mediaAsset?.variants ?? null,
      desktop: record
        ? {
            focalX: record.desktopFocalX,
            focalY: record.desktopFocalY,
            zoom: record.desktopZoom,
            fit: record.desktopFit,
          }
        : { ...DEFAULT_FRAME },
      mobile: record
        ? {
            focalX: record.mobileFocalX,
            focalY: record.mobileFocalY,
            zoom: record.mobileZoom,
            fit: record.mobileFit,
          }
        : { ...DEFAULT_FRAME },
      mediaOpacity: record?.mediaOpacity ?? 1,
      asciiEnabled: record?.asciiEnabled ?? true,
      asciiOpacity: record?.asciiOpacity ?? 1,
      revision: record?.revision ?? 0,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  private async record() {
    return this.prisma.newsletterSettings.findUnique({
      where: { id: SETTINGS_ID },
      include: { mediaAsset: true },
    });
  }

  async getPublicSettings() {
    const value = this.serialize(await this.record());
    return {
      version: 1,
      source: value.source,
      variants: value.variants,
      desktop: value.desktop,
      mobile: value.mobile,
      mediaOpacity: value.mediaOpacity,
      asciiEnabled: value.asciiEnabled,
      asciiOpacity: value.asciiOpacity,
    };
  }

  async getAdminSettings() {
    return this.serialize(await this.record());
  }

  async listImageAssets() {
    const assets = await this.prisma.websiteMediaAsset.findMany({
      where: { mediaType: 'image' },
      orderBy: { createdAt: 'desc' },
    });
    return {
      assets: assets.map((asset) => ({
        id: asset.id,
        source: asset.publicUrl,
        variants: asset.variants,
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
      })),
    };
  }

  async uploadImage(file: Express.Multer.File | undefined, adminId?: number) {
    if (
      !file ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
    ) {
      throw new BadRequestException('Selecciona una imagen JPEG, PNG o WebP');
    }
    const uploaded = await this.storage.uploadWebsiteMedia(
      file,
      'newsletter',
      adminId,
    );
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.websiteMediaAsset.create({ data: uploaded });
      await tx.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action: 'newsletter.asset.upload',
          actionType: 'CREATE',
          targetType: 'website-media-asset',
          targetId: created.id,
          metadata: {
            folderKey: uploaded.folderKey,
            originalFilename: uploaded.originalFilename,
            fileSize: uploaded.fileSize,
          },
        },
      });
      return created;
    });
    return { asset };
  }

  async update(dto: UpdateNewsletterSettingsDto, adminId?: number) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.newsletterSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        const revision = current?.revision ?? 0;
        if (revision !== dto.expectedRevision) throw new ConflictException();

        const assetId = dto.mediaAssetId || null;
        if (assetId) {
          const asset = await tx.websiteMediaAsset.findUnique({
            where: { id: assetId },
          });
          if (!asset || asset.mediaType !== 'image') {
            throw new NotFoundException('Imagen de newsletter no encontrada');
          }
        }

        const data = {
          mediaAssetId: assetId,
          desktopFocalX: dto.desktop.focalX,
          desktopFocalY: dto.desktop.focalY,
          desktopZoom: dto.desktop.zoom,
          desktopFit: dto.desktop.fit,
          mobileFocalX: dto.mobile.focalX,
          mobileFocalY: dto.mobile.focalY,
          mobileZoom: dto.mobile.zoom,
          mobileFit: dto.mobile.fit,
          mediaOpacity: dto.mediaOpacity ?? current?.mediaOpacity ?? 1,
          asciiEnabled: dto.asciiEnabled,
          asciiOpacity: dto.asciiOpacity,
          updatedBy: adminId ?? null,
        };

        if (current) {
          const result = await tx.newsletterSettings.updateMany({
            where: { id: SETTINGS_ID, revision: dto.expectedRevision },
            data: { ...data, revision: { increment: 1 } },
          });
          if (result.count !== 1) throw new ConflictException();
        } else {
          await tx.newsletterSettings.create({
            data: { id: SETTINGS_ID, ...data, revision: 1 },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: adminId ?? null,
            action: 'newsletter.settings.update',
            actionType: 'UPDATE',
            targetType: 'newsletter-settings',
            targetId: SETTINGS_ID,
            metadata: {
              before: current
                ? {
                    mediaAssetId: current.mediaAssetId,
                    desktop: {
                      focalX: current.desktopFocalX,
                      focalY: current.desktopFocalY,
                      zoom: current.desktopZoom,
                      fit: current.desktopFit,
                    },
                    mobile: {
                      focalX: current.mobileFocalX,
                      focalY: current.mobileFocalY,
                      zoom: current.mobileZoom,
                      fit: current.mobileFit,
                    },
                    mediaOpacity: current.mediaOpacity,
                    asciiEnabled: current.asciiEnabled,
                    asciiOpacity: current.asciiOpacity,
                  }
                : null,
              after: {
                mediaAssetId: assetId,
                desktop: { ...dto.desktop },
                mobile: { ...dto.mobile },
                mediaOpacity: dto.mediaOpacity ?? current?.mediaOpacity ?? 1,
                asciiEnabled: dto.asciiEnabled,
                asciiOpacity: dto.asciiOpacity,
              },
              revision: revision + 1,
            },
          },
        });
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        throw new ConflictException(
          'Otro administrador actualizó Newsletter. Recarga antes de guardar.',
        );
      }
      throw error;
    }
    return this.getAdminSettings();
  }
}
