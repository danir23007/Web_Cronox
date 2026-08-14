import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GalleryPlaceholderColor, Prisma } from '@prisma/client';
import type { Express } from 'express';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateGallerySlotDto } from './dto/update-gallery-slot.dto';
import { normalizeInstagramPostUrl } from './gallery-url';

export const GALLERY_SLOT_DEFINITIONS = [
  {
    key: 'featured',
    displayOrder: 0,
    featured: true,
    placeholderColor: GalleryPlaceholderColor.GREY,
  },
  {
    key: 'slot-01',
    displayOrder: 1,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.WHITE,
  },
  {
    key: 'slot-02',
    displayOrder: 2,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.RED,
  },
  {
    key: 'slot-03',
    displayOrder: 3,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.GREY,
  },
  {
    key: 'slot-04',
    displayOrder: 4,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.WHITE,
  },
  {
    key: 'slot-05',
    displayOrder: 5,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.GREY,
  },
  {
    key: 'slot-06',
    displayOrder: 6,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.WHITE,
  },
  {
    key: 'slot-07',
    displayOrder: 7,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.RED,
  },
  {
    key: 'slot-08',
    displayOrder: 8,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.GREY,
  },
  {
    key: 'slot-09',
    displayOrder: 9,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.RED,
  },
  {
    key: 'slot-10',
    displayOrder: 10,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.GREY,
  },
  {
    key: 'slot-11',
    displayOrder: 11,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.WHITE,
  },
  {
    key: 'slot-12',
    displayOrder: 12,
    featured: false,
    placeholderColor: GalleryPlaceholderColor.RED,
  },
] as const;

type GallerySlotWithAsset = Prisma.GallerySlotGetPayload<{
  include: { asset: true };
}>;

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  private async ensureStableSlots() {
    await this.prisma.gallerySlot.createMany({
      data: GALLERY_SLOT_DEFINITIONS.map((slot) => ({ ...slot })),
      skipDuplicates: true,
    });
  }

  private toAdminSlot(slot: GallerySlotWithAsset) {
    return {
      key: slot.key,
      displayOrder: slot.displayOrder,
      featured: slot.featured,
      placeholderColor: slot.placeholderColor.toLowerCase(),
      focalX: slot.focalX,
      focalY: slot.focalY,
      zoom: slot.zoom,
      altText: slot.altText,
      instagramUrl: slot.instagramUrl,
      updatedAt: slot.updatedAt,
      asset: slot.asset
        ? {
            id: slot.asset.id,
            imageUrl: slot.asset.publicUrl,
            originalFilename: slot.asset.originalFilename,
            mimeType: slot.asset.mimeType,
            fileSize: slot.asset.fileSize,
            width: slot.asset.width,
            height: slot.asset.height,
            createdAt: slot.asset.createdAt,
          }
        : null,
    };
  }

  private toPublicSlot(slot: GallerySlotWithAsset) {
    return {
      key: slot.key,
      displayOrder: slot.displayOrder,
      featured: slot.featured,
      placeholderColor: slot.placeholderColor.toLowerCase(),
      imageSrc: slot.asset?.publicUrl ?? null,
      alt: slot.asset ? slot.altText : '',
      instagramUrl: slot.asset ? slot.instagramUrl : null,
      focalX: slot.focalX,
      focalY: slot.focalY,
      zoom: slot.zoom,
    };
  }

  async getPublicGallery() {
    const stored = await this.prisma.gallerySlot.findMany({
      orderBy: { displayOrder: 'asc' },
      include: { asset: true },
    });
    const byKey = new Map(stored.map((slot) => [slot.key, slot]));
    const slots = GALLERY_SLOT_DEFINITIONS.map((definition) => {
      const slot = byKey.get(definition.key);
      if (slot) return this.toPublicSlot(slot);
      return {
        ...definition,
        placeholderColor: definition.placeholderColor.toLowerCase(),
        imageSrc: null,
        alt: '',
        instagramUrl: null,
        focalX: 50,
        focalY: 50,
        zoom: 1,
      };
    });
    return { slots };
  }

  async getAdminSlots() {
    await this.ensureStableSlots();
    const slots = await this.prisma.gallerySlot.findMany({
      orderBy: { displayOrder: 'asc' },
      include: { asset: true },
    });
    return { slots: slots.map((slot) => this.toAdminSlot(slot)) };
  }

  async getAssetLibrary() {
    const assets = await this.prisma.galleryAsset.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      assets: assets.map((asset) => ({
        id: asset.id,
        imageUrl: asset.publicUrl,
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
      })),
    };
  }

  async uploadAsset(file: Express.Multer.File | undefined, adminId?: number) {
    const uploaded = await this.storage.uploadGalleryImage(file, adminId);
    const asset = await this.prisma.galleryAsset.create({ data: uploaded });
    return {
      asset: {
        id: asset.id,
        imageUrl: asset.publicUrl,
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
      },
    };
  }

  async updateSlot(key: string, dto: UpdateGallerySlotDto, adminId?: number) {
    if (!GALLERY_SLOT_DEFINITIONS.some((slot) => slot.key === key)) {
      throw new NotFoundException('Posicion de galeria no encontrada');
    }
    await this.ensureStableSlots();

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.gallerySlot.findUnique({
        where: { key },
        include: { asset: true },
      });
      if (!current) {
        throw new NotFoundException('Posicion de galeria no encontrada');
      }

      const nextAssetId =
        dto.assetId === undefined ? current.assetId : dto.assetId || null;
      if (nextAssetId) {
        const asset = await tx.galleryAsset.findUnique({
          where: { id: nextAssetId },
          select: { id: true },
        });
        if (!asset) throw new NotFoundException('Foto antigua no encontrada');
      }

      const altText =
        dto.altText === undefined ? current.altText : dto.altText.trim();
      if (nextAssetId && altText.length < 3) {
        throw new BadRequestException(
          'El texto alternativo es obligatorio para una imagen publicada',
        );
      }

      const instagramUrl =
        dto.instagramUrl === undefined
          ? current.instagramUrl
          : normalizeInstagramPostUrl(dto.instagramUrl);

      const updated = await tx.gallerySlot.update({
        where: { key },
        data: {
          assetId: nextAssetId,
          focalX: dto.focalX ?? current.focalX,
          focalY: dto.focalY ?? current.focalY,
          zoom: dto.zoom ?? current.zoom,
          altText: nextAssetId ? altText : '',
          instagramUrl: nextAssetId ? instagramUrl : null,
        },
        include: { asset: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action: 'gallery.slot.update',
          actionType: 'UPDATE',
          targetType: 'gallery-slot',
          targetId: key,
          metadata: {
            assetId: nextAssetId,
            focalX: updated.focalX,
            focalY: updated.focalY,
            zoom: updated.zoom,
          },
        },
      });

      return { slot: this.toAdminSlot(updated) };
    });
  }
}
