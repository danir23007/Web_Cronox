import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GalleryPlaceholderColor, Prisma } from '@prisma/client';
import type { Express } from 'express';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSearchText } from '../products/product-search';
import { GalleryAssetQueryDto } from './dto/gallery-asset-query.dto';
import { GalleryProductQueryDto } from './dto/gallery-product-query.dto';
import { ReorderGallerySlotsDto } from './dto/reorder-gallery-slots.dto';
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

const GALLERY_PRODUCT_SELECT = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  slug: true,
  name: true,
  price: true,
  currency: true,
  imageUrl: true,
  isActive: true,
  images: {
    select: { url: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
  },
});

const GALLERY_ASSET_INCLUDE = Prisma.validator<Prisma.GalleryAssetInclude>()({
  products: {
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: { product: { select: GALLERY_PRODUCT_SELECT } },
  },
});

const GALLERY_SLOT_INCLUDE = Prisma.validator<Prisma.GallerySlotInclude>()({
  asset: { include: GALLERY_ASSET_INCLUDE },
});

type GalleryAssetWithProducts = Prisma.GalleryAssetGetPayload<{
  include: typeof GALLERY_ASSET_INCLUDE;
}>;
type GallerySlotWithAsset = Prisma.GallerySlotGetPayload<{
  include: typeof GALLERY_SLOT_INCLUDE;
}>;
type GalleryProductSummary = Prisma.ProductGetPayload<{
  select: typeof GALLERY_PRODUCT_SELECT;
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

  private toProductSummary(product: GalleryProductSummary) {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      currency: product.currency,
      imageUrl: product.images[0]?.url || product.imageUrl || null,
      available: product.isActive,
    };
  }

  private toAdminAsset(asset: GalleryAssetWithProducts) {
    return {
      id: asset.id,
      imageUrl: asset.publicUrl,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      width: asset.width,
      height: asset.height,
      description: asset.description,
      products: (asset.products ?? []).map((item) =>
        this.toProductSummary(item.product),
      ),
      createdAt: asset.createdAt,
    };
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
      fit: slot.fit,
      tabletFocalX: slot.tabletFocalX,
      tabletFocalY: slot.tabletFocalY,
      tabletZoom: slot.tabletZoom,
      tabletFit: slot.tabletFit,
      mobileFocalX: slot.mobileFocalX,
      mobileFocalY: slot.mobileFocalY,
      mobileZoom: slot.mobileZoom,
      mobileFit: slot.mobileFit,
      revision: slot.revision,
      altText: slot.altText,
      instagramUrl: slot.instagramUrl,
      updatedAt: slot.updatedAt,
      asset: slot.asset ? this.toAdminAsset(slot.asset) : null,
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
      fit: slot.fit,
      tablet:
        slot.tabletFocalX !== null &&
        slot.tabletFocalY !== null &&
        slot.tabletZoom !== null &&
        slot.tabletFit !== null
          ? {
              focalX: slot.tabletFocalX,
              focalY: slot.tabletFocalY,
              zoom: slot.tabletZoom,
              fit: slot.tabletFit,
            }
          : null,
      mobile:
        slot.mobileFocalX !== null &&
        slot.mobileFocalY !== null &&
        slot.mobileZoom !== null &&
        slot.mobileFit !== null
          ? {
              focalX: slot.mobileFocalX,
              focalY: slot.mobileFocalY,
              zoom: slot.mobileZoom,
              fit: slot.mobileFit,
            }
          : null,
      description: slot.asset?.description ?? null,
      products:
        slot.asset?.products?.map((item) =>
          this.toProductSummary(item.product),
        ) ?? [],
    };
  }

  async getPublicGallery() {
    const stored = await this.prisma.gallerySlot.findMany({
      orderBy: { displayOrder: 'asc' },
      include: GALLERY_SLOT_INCLUDE,
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
        fit: 'COVER',
        tablet: null,
        mobile: null,
        description: null,
        products: [],
      };
    });
    return { slots };
  }

  async getAdminSlots() {
    await this.ensureStableSlots();
    const slots = await this.prisma.gallerySlot.findMany({
      orderBy: { displayOrder: 'asc' },
      include: GALLERY_SLOT_INCLUDE,
    });
    return { slots: slots.map((slot) => this.toAdminSlot(slot)) };
  }

  async getAssetLibrary(query: GalleryAssetQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const [assets, total] = await Promise.all([
      this.prisma.galleryAsset.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: GALLERY_ASSET_INCLUDE,
      }),
      this.prisma.galleryAsset.count(),
    ]);
    return {
      assets: assets.map((asset) => this.toAdminAsset(asset)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getAssetDetails(id: string) {
    const asset = await this.prisma.galleryAsset.findUnique({
      where: { id },
      include: GALLERY_ASSET_INCLUDE,
    });
    if (!asset) throw new NotFoundException('Foto antigua no encontrada');
    return { asset: this.toAdminAsset(asset) };
  }

  async getProductRepository(query: GalleryProductQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const search = String(query.search || '').trim();
    const normalizedSearch = normalizeSearchText(search);
    const where: Prisma.ProductWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
            { searchText: { contains: normalizedSearch } },
            {
              variants: {
                some: { sku: { contains: search, mode: 'insensitive' } },
              },
            },
            {
              categories: {
                some: {
                  category: {
                    OR: [
                      { name: { contains: search, mode: 'insensitive' } },
                      { slug: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {};
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: GALLERY_PRODUCT_SELECT,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      products: products.map((product) => this.toProductSummary(product)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async uploadAsset(file: Express.Multer.File | undefined, adminId?: number) {
    const uploaded = await this.storage.uploadGalleryImage(file, adminId);
    const asset = await this.prisma.galleryAsset.create({
      data: uploaded,
      include: GALLERY_ASSET_INCLUDE,
    });
    return { asset: this.toAdminAsset(asset) };
  }

  private uniqueProductIds(productIds: number[]) {
    return [...new Set(productIds)];
  }

  async updateSlot(key: string, dto: UpdateGallerySlotDto, adminId?: number) {
    if (!GALLERY_SLOT_DEFINITIONS.some((slot) => slot.key === key)) {
      throw new NotFoundException('Posicion de galeria no encontrada');
    }
    await this.ensureStableSlots();

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.gallerySlot.findUnique({
        where: { key },
        include: GALLERY_SLOT_INCLUDE,
      });
      if (!current) {
        throw new NotFoundException('Posicion de galeria no encontrada');
      }

      const nextAssetId =
        dto.assetId === undefined ? current.assetId : dto.assetId || null;
      const updatesAssetContent =
        dto.description !== undefined || dto.productIds !== undefined;
      let nextAsset: GalleryAssetWithProducts | null = null;
      if (nextAssetId) {
        nextAsset = await tx.galleryAsset.findUnique({
          where: { id: nextAssetId },
          include: GALLERY_ASSET_INCLUDE,
        });
        if (!nextAsset)
          throw new NotFoundException('Foto antigua no encontrada');
      } else if (updatesAssetContent) {
        throw new BadRequestException(
          'Selecciona una foto antes de guardar productos o texto',
        );
      }

      const productIds =
        dto.productIds === undefined
          ? undefined
          : this.uniqueProductIds(dto.productIds);
      if (productIds?.length) {
        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true },
        });
        if (products.length !== productIds.length) {
          throw new BadRequestException(
            'Uno o mas productos seleccionados no son validos',
          );
        }
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
      const description =
        dto.description === undefined
          ? undefined
          : dto.description?.trim() || null;

      if (nextAsset && updatesAssetContent) {
        await tx.galleryAsset.update({
          where: { id: nextAsset.id },
          data: {
            ...(description !== undefined ? { description } : {}),
            ...(productIds !== undefined
              ? {
                  products: {
                    deleteMany: {},
                    create: productIds.map((productId, position) => ({
                      productId,
                      position,
                    })),
                  },
                }
              : {}),
          },
        });
      }

      const updated = await tx.gallerySlot.update({
        where: { key },
        data: {
          assetId: nextAssetId,
          focalX: dto.focalX ?? current.focalX,
          focalY: dto.focalY ?? current.focalY,
          zoom: dto.zoom ?? current.zoom,
          revision: { increment: 1 },
          altText: nextAssetId ? altText : '',
          instagramUrl: nextAssetId ? instagramUrl : null,
        },
        include: GALLERY_SLOT_INCLUDE,
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
            productCount: updated.asset?.products?.length ?? 0,
          },
        },
      });

      return { slot: this.toAdminSlot(updated) };
    });
  }

  async reorderSlots(dto: ReorderGallerySlotsDto, adminId?: number) {
    const { sourceKey, targetKey } = dto;
    const stableKeys = new Set<string>(
      GALLERY_SLOT_DEFINITIONS.map((slot) => slot.key),
    );
    if (!stableKeys.has(sourceKey) || !stableKeys.has(targetKey)) {
      throw new BadRequestException(
        'Posici\u00f3n de galer\u00eda no v\u00e1lida',
      );
    }
    if (sourceKey === targetKey) {
      throw new BadRequestException(
        'La posici\u00f3n de origen y destino deben ser diferentes',
      );
    }

    await this.ensureStableSlots();
    return this.prisma.$transaction(
      async (tx) => {
        const affected = await tx.gallerySlot.findMany({
          where: { key: { in: [sourceKey, targetKey] } },
          include: GALLERY_SLOT_INCLUDE,
        });
        const source = affected.find((slot) => slot.key === sourceKey);
        const target = affected.find((slot) => slot.key === targetKey);
        if (!source || !target) {
          throw new NotFoundException(
            'Posici\u00f3n de galer\u00eda no encontrada',
          );
        }
        if (!source.assetId) {
          throw new BadRequestException(
            'La posici\u00f3n de origen no contiene ninguna foto',
          );
        }

        const contentOf = (slot: GallerySlotWithAsset) => ({
          assetId: slot.assetId,
          altText: slot.altText,
          instagramUrl: slot.instagramUrl,
          focalX: slot.focalX,
          focalY: slot.focalY,
          zoom: slot.zoom,
          fit: slot.fit,
          tabletFocalX: slot.tabletFocalX,
          tabletFocalY: slot.tabletFocalY,
          tabletZoom: slot.tabletZoom,
          tabletFit: slot.tabletFit,
          mobileFocalX: slot.mobileFocalX,
          mobileFocalY: slot.mobileFocalY,
          mobileZoom: slot.mobileZoom,
          mobileFit: slot.mobileFit,
        });
        const emptyContent = {
          assetId: null,
          altText: '',
          instagramUrl: null,
          focalX: 50,
          focalY: 50,
          zoom: 1,
          fit: 'COVER' as const,
          tabletFocalX: null,
          tabletFocalY: null,
          tabletZoom: null,
          tabletFit: null,
          mobileFocalX: null,
          mobileFocalY: null,
          mobileZoom: null,
          mobileFit: null,
        };
        const sourceContent = contentOf(source);
        const targetContent = target.assetId ? contentOf(target) : emptyContent;
        const operation = target.assetId ? 'swap' : 'move';

        await tx.gallerySlot.update({
          where: { key: sourceKey },
          data: { ...targetContent, revision: { increment: 1 } },
        });
        await tx.gallerySlot.update({
          where: { key: targetKey },
          data: { ...sourceContent, revision: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            actorId: adminId ?? null,
            action: 'gallery.slots.reorder',
            actionType: 'UPDATE',
            targetType: 'gallery-slot',
            targetId: `${sourceKey}:${targetKey}`,
            metadata: { sourceKey, targetKey, operation },
          },
        });

        const slots = await tx.gallerySlot.findMany({
          orderBy: { displayOrder: 'asc' },
          include: GALLERY_SLOT_INCLUDE,
        });
        return {
          operation,
          sourceKey,
          targetKey,
          slots: slots.map((slot) => this.toAdminSlot(slot)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
