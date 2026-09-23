import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaFitMode, Prisma } from '@prisma/client';
import type { Express } from 'express';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ResetMediaFramingDto,
  SelectWebsiteMediaAssetDto,
  UpdateMediaFramingDto,
} from './dto/media-frame.dto';
import {
  MEDIA_PLACEMENT_BY_KEY,
  MEDIA_PLACEMENTS,
  type MediaFrame,
  type MediaPlacementDefinition,
} from './media-placement.registry';

type NullableFrameFields = {
  focalX: number;
  focalY: number;
  zoom: number;
  fit: MediaFitMode;
  tabletFocalX: number | null;
  tabletFocalY: number | null;
  tabletZoom: number | null;
  tabletFit: MediaFitMode | null;
  mobileFocalX: number | null;
  mobileFocalY: number | null;
  mobileZoom: number | null;
  mobileFit: MediaFitMode | null;
  revision: number;
  updatedAt?: Date | null;
  assetId?: string | null;
  asset?: WebsiteMediaAssetRecord | null;
  heroText?: string | null;
  heroTextEnabled?: boolean;
  heroTextX?: number;
  heroTextY?: number;
  heroTextTabletX?: number;
  heroTextTabletY?: number;
  heroTextTabletAlign?: string;
  heroTextTabletColor?: string;
  heroTextTabletFontSize?: number;
  heroTextTabletFontWeight?: number;
  heroTextTabletLetterSpacing?: number;
  heroTextTabletUppercase?: boolean;
  heroTextTabletMaxWidth?: number;
  heroTextMobileX?: number;
  heroTextMobileY?: number;
  heroTextMobileAlign?: string;
  heroTextMobileColor?: string;
  heroTextAlign?: string;
  heroTextColor?: string;
  heroTextFontSize?: number;
  heroTextMobileFontSize?: number;
  heroTextMobileFontWeight?: number;
  heroTextMobileLetterSpacing?: number;
  heroTextMobileUppercase?: boolean;
  heroTextMobileMaxWidth?: number;
  heroTextFontWeight?: number;
  heroTextLetterSpacing?: number;
  heroTextUppercase?: boolean;
  heroTextMaxWidth?: number;
};

type WebsiteMediaAssetRecord = {
  id: string;
  storageKey: string;
  publicUrl: string;
  originalFilename: string;
  mimeType: string;
  mediaType: string;
  folderKey: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  variants: Prisma.JsonValue | null;
  createdAt: Date;
};

type ResponsiveFrames = {
  desktop: MediaFrame;
  tablet: MediaFrame | null;
  mobile: MediaFrame | null;
};

const defaultHeroTextViewport = (fontSize = 42) => ({
  x: 50,
  y: 50,
  align: 'CENTER' as const,
  color: '#ffffff',
  fontSize,
  fontWeight: 800,
  letterSpacing: 1.5,
  uppercase: false,
  maxWidth: 90,
});

const defaultHeroText = () => ({
  enabled: false,
  content: '',
  desktop: defaultHeroTextViewport(),
  tablet: defaultHeroTextViewport(),
  mobile: defaultHeroTextViewport(30),
});

const supportedAlignment = (value?: string) =>
  ['LEFT', 'CENTER', 'RIGHT'].includes(value || '')
    ? (value as 'LEFT' | 'CENTER' | 'RIGHT')
    : 'CENTER';

const resolveHeroText = (record?: NullableFrameFields | null) => ({
  enabled: Boolean(record?.heroTextEnabled),
  content: record?.heroText ?? '',
  desktop: {
    x: record?.heroTextX ?? 50,
    y: record?.heroTextY ?? 50,
    align: supportedAlignment(record?.heroTextAlign),
    color: record?.heroTextColor ?? '#ffffff',
    fontSize: record?.heroTextFontSize ?? 42,
    fontWeight: record?.heroTextFontWeight ?? 800,
    letterSpacing: record?.heroTextLetterSpacing ?? 1.5,
    uppercase: Boolean(record?.heroTextUppercase),
    maxWidth: record?.heroTextMaxWidth ?? 90,
  },
  tablet: {
    x: record?.heroTextTabletX ?? record?.heroTextX ?? 50,
    y: record?.heroTextTabletY ?? record?.heroTextY ?? 50,
    align: supportedAlignment(
      record?.heroTextTabletAlign ?? record?.heroTextAlign,
    ),
    color: record?.heroTextTabletColor ?? record?.heroTextColor ?? '#ffffff',
    fontSize: record?.heroTextTabletFontSize ?? record?.heroTextFontSize ?? 42,
    fontWeight:
      record?.heroTextTabletFontWeight ?? record?.heroTextFontWeight ?? 800,
    letterSpacing:
      record?.heroTextTabletLetterSpacing ??
      record?.heroTextLetterSpacing ??
      1.5,
    uppercase: Boolean(
      record?.heroTextTabletUppercase ?? record?.heroTextUppercase,
    ),
    maxWidth: record?.heroTextTabletMaxWidth ?? record?.heroTextMaxWidth ?? 90,
  },
  mobile: {
    x: record?.heroTextMobileX ?? record?.heroTextX ?? 50,
    y: record?.heroTextMobileY ?? record?.heroTextY ?? 50,
    align: supportedAlignment(
      record?.heroTextMobileAlign ?? record?.heroTextAlign,
    ),
    color: record?.heroTextMobileColor ?? record?.heroTextColor ?? '#ffffff',
    fontSize: record?.heroTextMobileFontSize ?? 30,
    fontWeight:
      record?.heroTextMobileFontWeight ?? record?.heroTextFontWeight ?? 800,
    letterSpacing:
      record?.heroTextMobileLetterSpacing ??
      record?.heroTextLetterSpacing ??
      1.5,
    uppercase: Boolean(
      record?.heroTextMobileUppercase ?? record?.heroTextUppercase,
    ),
    maxWidth: record?.heroTextMobileMaxWidth ?? record?.heroTextMaxWidth ?? 90,
  },
});

const heroTextFields = (value: UpdateMediaFramingDto['heroText']) =>
  value
    ? {
        heroText:
          value.content
            .split('')
            .filter((character) => {
              const code = character.charCodeAt(0);
              return (
                code === 9 ||
                code === 10 ||
                code === 13 ||
                (code >= 32 && code !== 127)
              );
            })
            .join('')
            .trim() || null,
        heroTextEnabled: value.enabled,
        heroTextX: value.desktop.x,
        heroTextY: value.desktop.y,
        heroTextAlign: value.desktop.align,
        heroTextColor: value.desktop.color.toLowerCase(),
        heroTextFontSize: value.desktop.fontSize,
        heroTextFontWeight: value.desktop.fontWeight,
        heroTextLetterSpacing: value.desktop.letterSpacing,
        heroTextUppercase: value.desktop.uppercase,
        heroTextMaxWidth: value.desktop.maxWidth,
        heroTextTabletX: value.tablet.x,
        heroTextTabletY: value.tablet.y,
        heroTextTabletAlign: value.tablet.align,
        heroTextTabletColor: value.tablet.color.toLowerCase(),
        heroTextTabletFontSize: value.tablet.fontSize,
        heroTextTabletFontWeight: value.tablet.fontWeight,
        heroTextTabletLetterSpacing: value.tablet.letterSpacing,
        heroTextTabletUppercase: value.tablet.uppercase,
        heroTextTabletMaxWidth: value.tablet.maxWidth,
        heroTextMobileX: value.mobile.x,
        heroTextMobileY: value.mobile.y,
        heroTextMobileAlign: value.mobile.align,
        heroTextMobileColor: value.mobile.color.toLowerCase(),
        heroTextMobileFontSize: value.mobile.fontSize,
        heroTextMobileFontWeight: value.mobile.fontWeight,
        heroTextMobileLetterSpacing: value.mobile.letterSpacing,
        heroTextMobileUppercase: value.mobile.uppercase,
        heroTextMobileMaxWidth: value.mobile.maxWidth,
      }
    : {};

const toOptionalFrame = (
  focalX: number | null,
  focalY: number | null,
  zoom: number | null,
  fit: MediaFitMode | null,
): MediaFrame | null =>
  focalX === null || focalY === null || zoom === null || fit === null
    ? null
    : { focalX, focalY, zoom, fit };

const toResponsiveFrames = (record: NullableFrameFields): ResponsiveFrames => ({
  desktop: {
    focalX: record.focalX,
    focalY: record.focalY,
    zoom: record.zoom,
    fit: record.fit,
  },
  tablet: toOptionalFrame(
    record.tabletFocalX,
    record.tabletFocalY,
    record.tabletZoom,
    record.tabletFit,
  ),
  mobile: toOptionalFrame(
    record.mobileFocalX,
    record.mobileFocalY,
    record.mobileZoom,
    record.mobileFit,
  ),
});

const framesFromDto = (dto: UpdateMediaFramingDto): ResponsiveFrames => ({
  desktop: { ...dto.desktop },
  tablet: dto.tablet ? { ...dto.tablet } : null,
  mobile: dto.mobile ? { ...dto.mobile } : null,
});

const writeFields = (frames: ResponsiveFrames) => ({
  focalX: frames.desktop.focalX,
  focalY: frames.desktop.focalY,
  zoom: frames.desktop.zoom,
  fit: frames.desktop.fit,
  tabletFocalX: frames.tablet?.focalX ?? null,
  tabletFocalY: frames.tablet?.focalY ?? null,
  tabletZoom: frames.tablet?.zoom ?? null,
  tabletFit: frames.tablet?.fit ?? null,
  mobileFocalX: frames.mobile?.focalX ?? null,
  mobileFocalY: frames.mobile?.focalY ?? null,
  mobileZoom: frames.mobile?.zoom ?? null,
  mobileFit: frames.mobile?.fit ?? null,
});

const sameFrame = (left: MediaFrame, right: MediaFrame) =>
  left.focalX === right.focalX &&
  left.focalY === right.focalY &&
  left.zoom === right.zoom &&
  left.fit === right.fit;

const statusFor = (frames: ResponsiveFrames, defaults: MediaFrame) => {
  if (frames.tablet || frames.mobile) return 'RESPONSIVE_CUSTOM';
  return sameFrame(frames.desktop, defaults) ? 'DEFAULT' : 'CUSTOM';
};

const safeFilename = (value: string) => {
  try {
    const pathname = new URL(value, 'https://cronox.invalid').pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return '';
  }
};

@Injectable()
export class MediaFramingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  private defaultFrames(
    definition: MediaPlacementDefinition,
  ): ResponsiveFrames {
    return { desktop: { ...definition.defaults }, tablet: null, mobile: null };
  }

  private resolveFrames(
    definition: MediaPlacementDefinition,
    stored?: NullableFrameFields | null,
  ): ResponsiveFrames {
    return stored ? toResponsiveFrames(stored) : this.defaultFrames(definition);
  }

  private resolveMedia(
    definition: MediaPlacementDefinition,
    stored?: NullableFrameFields | null,
  ) {
    const asset = stored?.asset;
    if (asset) {
      return {
        assetId: asset.id,
        source: asset.publicUrl,
        variants: asset.variants,
        sourceFilename: asset.originalFilename,
        mediaType:
          asset.mediaType === 'video' ? ('video' as const) : ('image' as const),
        poster: null,
        authority: 'library' as const,
      };
    }
    return {
      assetId: null,
      source: `/${definition.staticSource}`,
      sourceFilename: safeFilename(definition.staticSource),
      mediaType: definition.mediaType,
      poster: definition.staticPoster ? `/${definition.staticPoster}` : null,
      authority: definition.sourceKind,
      variants: null,
    };
  }

  async getPublicFraming() {
    const stored = await this.prisma.websiteMediaPlacement.findMany({
      where: { key: { in: MEDIA_PLACEMENTS.map(({ key }) => key) } },
      include: { asset: true },
    });
    const byKey = new Map(stored.map((record) => [record.key, record]));
    return {
      version: 5,
      placements: Object.fromEntries(
        MEDIA_PLACEMENTS.map((definition) => [
          definition.key,
          (() => {
            const record = byKey.get(definition.key);
            const media = this.resolveMedia(definition, record);
            return {
              ...this.resolveFrames(definition, record),
              ...(definition.key === 'home.hero.video'
                ? { heroText: resolveHeroText(record) }
                : {}),
              source: media.source,
              ...(media.mediaType === 'image'
                ? { variants: media.variants }
                : {}),
              mediaType: media.mediaType,
              poster: media.poster,
            };
          })(),
        ]),
      ),
    };
  }

  async getAdminPlacements() {
    const stored = await this.prisma.websiteMediaPlacement.findMany({
      where: { key: { in: MEDIA_PLACEMENTS.map(({ key }) => key) } },
      include: { asset: true },
    });
    const byKey = new Map(stored.map((record) => [record.key, record]));
    return {
      placements: MEDIA_PLACEMENTS.map((definition) => {
        const record = byKey.get(definition.key);
        const framing = this.resolveFrames(definition, record);
        const media = this.resolveMedia(definition, record);
        return {
          key: definition.key,
          label: definition.label,
          route: definition.route,
          publicUrl: definition.publicUrl,
          category: definition.category,
          mediaType: media.mediaType,
          defaultMediaType: definition.mediaType,
          authority: media.authority,
          source: media.source,
          variants: media.variants,
          sourceFilename: media.sourceFilename,
          poster: media.poster,
          activeAssetId: media.assetId,
          libraryFolder: definition.libraryFolder,
          frame: definition.frame,
          preview: definition.preview,
          defaults: { ...definition.defaults },
          status: statusFor(framing, definition.defaults),
          framing,
          ...(definition.key === 'home.hero.video'
            ? {
                heroText: resolveHeroText(record),
                heroTextDefaults: defaultHeroText(),
              }
            : {}),
          revision: record?.revision ?? 0,
          updatedAt: record?.updatedAt ?? null,
        };
      }),
    };
  }

  async getAssetLibrary() {
    const [storedAssets, activePlacements] = await Promise.all([
      this.prisma.websiteMediaAsset.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.websiteMediaPlacement.findMany({
        where: { key: { in: MEDIA_PLACEMENTS.map(({ key }) => key) } },
        select: { key: true, assetId: true },
      }),
    ]);
    const activeByAsset = new Map<string, string[]>();
    activePlacements.forEach(({ key, assetId }) => {
      if (!assetId) return;
      activeByAsset.set(assetId, [...(activeByAsset.get(assetId) || []), key]);
    });

    const folders = new Map<
      string,
      {
        key: string;
        label: string;
        placementKeys: string[];
        photos: unknown[];
        videos: unknown[];
      }
    >();
    MEDIA_PLACEMENTS.forEach((definition) => {
      const folder = definition.libraryFolder;
      if (!folders.has(folder.key)) {
        folders.set(folder.key, {
          key: folder.key,
          label: folder.label,
          placementKeys: [],
          photos: [],
          videos: [],
        });
      }
      const target = folders.get(folder.key)!;
      if (!target.placementKeys.includes(definition.key)) {
        target.placementKeys.push(definition.key);
      }
      const isActive = !activePlacements.some(
        ({ key, assetId }) => key === definition.key && assetId,
      );
      const builtin = {
        id: `builtin:${definition.key}`,
        placementKey: definition.key,
        source: `/${definition.staticSource}`,
        poster: definition.staticPoster ? `/${definition.staticPoster}` : null,
        originalFilename: safeFilename(definition.staticSource),
        mimeType: definition.mediaType === 'video' ? 'video/mp4' : 'image/png',
        mediaType: definition.mediaType,
        fileSize: null,
        width: null,
        height: null,
        createdAt: null,
        builtin: true,
        activeFor: isActive ? [definition.key] : [],
      };
      (definition.mediaType === 'video' ? target.videos : target.photos).push(
        builtin,
      );
    });

    storedAssets.forEach((asset) => {
      const folder = folders.get(asset.folderKey);
      if (!folder) return;
      const item = {
        id: asset.id,
        source: asset.publicUrl,
        variants: asset.variants,
        poster: null,
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        mediaType: asset.mediaType,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
        builtin: false,
        activeFor: activeByAsset.get(asset.id) || [],
      };
      (asset.mediaType === 'video' ? folder.videos : folder.photos).push(item);
    });

    return { folders: [...folders.values()] };
  }

  async uploadAsset(
    key: string,
    file: Express.Multer.File | undefined,
    adminId?: number,
  ) {
    this.assertKnownKey(key);
    const definition = MEDIA_PLACEMENT_BY_KEY.get(key)!;
    const uploaded = await this.storage.uploadWebsiteMedia(
      file,
      definition.libraryFolder.key,
      adminId,
    );
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.websiteMediaAsset.create({ data: uploaded });
      await tx.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action: 'media.asset.upload',
          actionType: 'CREATE',
          targetType: 'website-media-asset',
          targetId: created.id,
          metadata: {
            placementKey: key,
            folderKey: uploaded.folderKey,
            mediaType: uploaded.mediaType,
            originalFilename: uploaded.originalFilename,
            fileSize: uploaded.fileSize,
          },
        },
      });
      return created;
    });
    return { asset };
  }

  async selectAsset(
    key: string,
    dto: SelectWebsiteMediaAssetDto,
    adminId?: number,
  ) {
    this.assertKnownKey(key);
    const definition = MEDIA_PLACEMENT_BY_KEY.get(key)!;
    const assetId = dto.assetId || null;
    const selected = assetId
      ? await this.prisma.websiteMediaAsset.findUnique({
          where: { id: assetId },
        })
      : null;
    if (
      assetId &&
      (!selected || selected.folderKey !== definition.libraryFolder.key)
    ) {
      throw new NotFoundException(
        'Archivo multimedia no encontrado en esta carpeta',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.websiteMediaPlacement.findUnique({
          where: { key },
        });
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== dto.expectedRevision)
          throw new ConflictException();
        if (current) {
          const result = await tx.websiteMediaPlacement.updateMany({
            where: { key, revision: dto.expectedRevision },
            data: { assetId, revision: { increment: 1 } },
          });
          if (result.count !== 1) throw new ConflictException();
        } else {
          await tx.websiteMediaPlacement.create({
            data: {
              key,
              assetId,
              ...writeFields(this.defaultFrames(definition)),
              revision: 1,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            actorId: adminId ?? null,
            action: 'media.asset.select',
            actionType: 'UPDATE',
            targetType: 'media-placement',
            targetId: key,
            metadata: {
              beforeAssetId: current?.assetId ?? null,
              afterAssetId: assetId,
              previousRevision: currentRevision,
              revision: currentRevision + 1,
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
          'Otro administrador cambió esta portada. Recarga Multimedia Web antes de continuar.',
        );
      }
      throw error;
    }
    return this.getAdminPlacement(key);
  }

  async getAdminPlacement(key: string) {
    this.assertKnownKey(key);
    const response = await this.getAdminPlacements();
    const placement = response.placements.find((item) => item.key === key);
    if (!placement) {
      throw new NotFoundException(
        'Ubicaci\u00f3n multimedia web no encontrada',
      );
    }
    return { placement };
  }

  private assertKnownKey(key: string) {
    if (!MEDIA_PLACEMENT_BY_KEY.has(key)) {
      throw new NotFoundException(
        'Ubicaci\u00f3n multimedia web no encontrada',
      );
    }
  }

  async updatePlacement(
    key: string,
    dto: UpdateMediaFramingDto,
    adminId?: number,
  ) {
    this.assertKnownKey(key);
    await this.writeWebsitePlacement(
      key,
      framesFromDto(dto),
      dto.expectedRevision,
      adminId,
      false,
      dto.heroText,
    );
    return this.getAdminPlacement(key);
  }

  async resetPlacement(
    key: string,
    dto: ResetMediaFramingDto,
    adminId?: number,
  ) {
    this.assertKnownKey(key);
    const definition = MEDIA_PLACEMENT_BY_KEY.get(key)!;
    await this.writeWebsitePlacement(
      key,
      this.defaultFrames(definition),
      dto.expectedRevision,
      adminId,
      true,
    );
    return this.getAdminPlacement(key);
  }

  private async writeWebsitePlacement(
    key: string,
    frames: ResponsiveFrames,
    expectedRevision: number,
    adminId: number | undefined,
    reset: boolean,
    heroText?: UpdateMediaFramingDto['heroText'],
  ) {
    const fields = {
      ...writeFields(frames),
      ...(key === 'home.hero.video' ? heroTextFields(heroText) : {}),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.websiteMediaPlacement.findUnique({
          where: { key },
        });
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== expectedRevision) throw new ConflictException();

        let revision: number;
        if (current) {
          const result = await tx.websiteMediaPlacement.updateMany({
            where: { key, revision: expectedRevision },
            data: { ...fields, revision: { increment: 1 } },
          });
          if (result.count !== 1) throw new ConflictException();
          revision = expectedRevision + 1;
        } else {
          revision = (
            await tx.websiteMediaPlacement.create({
              data: { key, ...fields, revision: 1 },
            })
          ).revision;
        }

        await tx.auditLog.create({
          data: {
            actorId: adminId ?? null,
            action: reset ? 'media.framing.reset' : 'media.framing.update',
            actionType: reset ? 'RESET' : 'UPDATE',
            targetType: 'media-placement',
            targetId: key,
            metadata: {
              before: current ? toResponsiveFrames(current) : null,
              after: frames,
              ...(heroText
                ? {
                    heroText: {
                      enabled: heroText.enabled,
                      content: '[stored as plain text]',
                      desktop: { ...heroText.desktop },
                      tablet: { ...heroText.tablet },
                      mobile: { ...heroText.mobile },
                    },
                  }
                : {}),
              previousRevision: currentRevision,
              revision,
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
          'Otro administrador guard\u00f3 cambios. Recarga la ubicaci\u00f3n antes de continuar.',
        );
      }
      throw error;
    }
  }
}
