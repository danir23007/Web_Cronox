import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GalleryPlaceholderColor,
  GalleryPresentationMode,
  Prisma,
} from '@prisma/client';
import type { Express } from 'express';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSearchText } from '../products/product-search';
import { GalleryAssetQueryDto } from './dto/gallery-asset-query.dto';
import { GalleryProductQueryDto } from './dto/gallery-product-query.dto';
import { ReorderGalleryCarouselDto } from './dto/reorder-gallery-carousel.dto';
import { ReorderGallerySlotsDto } from './dto/reorder-gallery-slots.dto';
import { UpdateGalleryCarouselSlotDto } from './dto/update-gallery-carousel-slot.dto';
import { UpdateGalleryModeDto } from './dto/update-gallery-mode.dto';
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

export const GALLERY_CAROUSEL_POSITIONS = [1, 2, 3, 4, 5] as const;
export const MIN_ACTIVE_CAROUSEL_ITEMS = 3;
export const MAX_ACTIVE_CAROUSEL_ITEMS = 5;

const GALLERY_PRODUCT_SELECT = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  slug: true,
  name: true,
  price: true,
  currency: true,
  imageUrl: true,
  isActive: true,
  images: {
    where: { isActive: true },
    select: { url: true, variants: true, width: true, height: true },
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
const GALLERY_CAROUSEL_SLOT_INCLUDE =
  Prisma.validator<Prisma.GalleryCarouselSlotInclude>()({
    asset: { include: GALLERY_ASSET_INCLUDE },
  });

type GalleryAssetWithProducts = Prisma.GalleryAssetGetPayload<{
  include: typeof GALLERY_ASSET_INCLUDE;
}>;
type GallerySlotWithAsset = Prisma.GallerySlotGetPayload<{
  include: typeof GALLERY_SLOT_INCLUDE;
}>;
type GalleryCarouselSlotWithAsset = Prisma.GalleryCarouselSlotGetPayload<{
  include: typeof GALLERY_CAROUSEL_SLOT_INCLUDE;
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

  private async ensureCarouselSlots() {
    await this.prisma.galleryCarouselSlot.createMany({
      data: GALLERY_CAROUSEL_POSITIONS.map((position) => ({ position })),
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
      imageRecord: product.images[0]
        ? {
            url: product.images[0].url,
            variants: product.images[0].variants,
            width: product.images[0].width,
            height: product.images[0].height,
          }
        : null,
      available: product.isActive,
    };
  }

  private carouselProductIds(value: Prisma.JsonValue | null): number[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (id): id is number => Number.isSafeInteger(id) && Number(id) > 0,
    );
  }

  private async loadCarouselProducts(
    slots: GalleryCarouselSlotWithAsset[],
    client: Pick<PrismaService, 'product'> = this.prisma,
  ) {
    const ids = [
      ...new Set(
        slots.flatMap((slot) =>
          this.carouselProductIds(slot.relatedProductIds),
        ),
      ),
    ];
    const products = ids.length
      ? await client.product.findMany({
          where: { id: { in: ids } },
          select: GALLERY_PRODUCT_SELECT,
        })
      : [];
    return new Map(products.map((product) => [product.id, product]));
  }

  private carouselProducts(
    slot: GalleryCarouselSlotWithAsset,
    products: Map<number, GalleryProductSummary>,
  ) {
    return this.carouselProductIds(slot.relatedProductIds)
      .map((id) => products.get(id))
      .filter((product): product is GalleryProductSummary => Boolean(product))
      .map((product) => this.toProductSummary(product));
  }

  private toAdminAsset(asset: GalleryAssetWithProducts) {
    return {
      id: asset.id,
      imageUrl: asset.publicUrl,
      variants: asset.variants,
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
      variants: slot.asset?.variants ?? null,
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

  private toAdminCarouselSlot(
    slot: GalleryCarouselSlotWithAsset,
    products: Map<number, GalleryProductSummary>,
  ) {
    return {
      position: slot.position,
      itemId: slot.asset ? slot.itemId : null,
      description: slot.asset ? slot.description : null,
      products: slot.asset ? this.carouselProducts(slot, products) : [],
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

  private toPublicCarouselItem(
    slot: GalleryCarouselSlotWithAsset,
    products: Map<number, GalleryProductSummary>,
  ) {
    return {
      key: slot.itemId || `carousel-${slot.position}`,
      itemId: slot.itemId,
      position: slot.position,
      imageSrc: slot.asset?.publicUrl ?? null,
      variants: slot.asset?.variants ?? null,
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
      description: slot.description,
      products: this.carouselProducts(slot, products),
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
    let configuredMode: GalleryPresentationMode =
      GalleryPresentationMode.MOSAIC;
    let carouselItems: ReturnType<GalleryService['toPublicCarouselItem']>[] =
      [];
    try {
      const [settings, carouselSlots] = await Promise.all([
        this.prisma.gallerySettings.findUnique({ where: { id: 'global' } }),
        this.prisma.galleryCarouselSlot.findMany({
          where: { assetId: { not: null } },
          orderBy: { position: 'asc' },
          include: GALLERY_CAROUSEL_SLOT_INCLUDE,
        }),
      ]);
      configuredMode =
        settings?.activeMode === GalleryPresentationMode.CAROUSEL
          ? GalleryPresentationMode.CAROUSEL
          : GalleryPresentationMode.MOSAIC;
      const carouselProducts = await this.loadCarouselProducts(carouselSlots);
      carouselItems = carouselSlots
        .filter((slot) => Boolean(slot.asset?.publicUrl))
        .map((slot) => this.toPublicCarouselItem(slot, carouselProducts));
    } catch {
      // Deploys remain backwards compatible while the additive migration is pending.
      configuredMode = GalleryPresentationMode.MOSAIC;
      carouselItems = [];
    }
    const mode =
      configuredMode === GalleryPresentationMode.CAROUSEL &&
      carouselItems.length >= MIN_ACTIVE_CAROUSEL_ITEMS
        ? GalleryPresentationMode.CAROUSEL
        : GalleryPresentationMode.MOSAIC;
    return { mode, slots, carouselItems };
  }

  async getAdminSlots() {
    await this.ensureStableSlots();
    const slots = await this.prisma.gallerySlot.findMany({
      orderBy: { displayOrder: 'asc' },
      include: GALLERY_SLOT_INCLUDE,
    });
    return { slots: slots.map((slot) => this.toAdminSlot(slot)) };
  }

  async getAdminConfiguration() {
    await this.ensureCarouselSlots();
    const [settings, carouselSlots] = await Promise.all([
      this.prisma.gallerySettings.findUnique({ where: { id: 'global' } }),
      this.prisma.galleryCarouselSlot.findMany({
        orderBy: { position: 'asc' },
        include: GALLERY_CAROUSEL_SLOT_INCLUDE,
      }),
    ]);
    const carouselProducts = await this.loadCarouselProducts(carouselSlots);
    return {
      activeMode: settings?.activeMode ?? GalleryPresentationMode.MOSAIC,
      carouselSlots: carouselSlots.map((slot) =>
        this.toAdminCarouselSlot(slot, carouselProducts),
      ),
      constraints: {
        minimumItems: MIN_ACTIVE_CAROUSEL_ITEMS,
        maximumItems: MAX_ACTIVE_CAROUSEL_ITEMS,
      },
    };
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

  async updateMode(dto: UpdateGalleryModeDto, adminId?: number) {
    await this.ensureCarouselSlots();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.gallerySettings.findUnique({
        where: { id: 'global' },
      });
      if (dto.activeMode === GalleryPresentationMode.CAROUSEL) {
        const carouselCandidates = await tx.galleryCarouselSlot.findMany({
          where: { assetId: { not: null } },
          select: { asset: { select: { publicUrl: true } } },
        });
        const activeItems = carouselCandidates.filter((slot) =>
          Boolean(slot.asset?.publicUrl?.trim()),
        ).length;
        if (
          activeItems < MIN_ACTIVE_CAROUSEL_ITEMS ||
          activeItems > MAX_ACTIVE_CAROUSEL_ITEMS
        ) {
          throw new BadRequestException(
            `El carrusel necesita entre ${MIN_ACTIVE_CAROUSEL_ITEMS} y ${MAX_ACTIVE_CAROUSEL_ITEMS} imágenes para activarse`,
          );
        }
      }

      if (current?.activeMode === dto.activeMode) {
        return { activeMode: current.activeMode, revision: current.revision };
      }
      const settings = await tx.gallerySettings.upsert({
        where: { id: 'global' },
        create: {
          id: 'global',
          activeMode: dto.activeMode,
          updatedBy: adminId ?? null,
        },
        update: {
          activeMode: dto.activeMode,
          updatedBy: adminId ?? null,
          revision: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action: 'gallery.mode.update',
          actionType: 'UPDATE',
          targetType: 'gallery-settings',
          targetId: 'global',
          metadata: {
            before: current?.activeMode ?? GalleryPresentationMode.MOSAIC,
            after: settings.activeMode,
          },
        },
      });
      return { activeMode: settings.activeMode, revision: settings.revision };
    });
  }

  async updateCarouselSlot(
    position: number,
    dto: UpdateGalleryCarouselSlotDto,
    adminId?: number,
  ) {
    if (!GALLERY_CAROUSEL_POSITIONS.includes(position as 1 | 2 | 3 | 4 | 5)) {
      throw new NotFoundException('Posición de carrusel no encontrada');
    }
    await this.ensureCarouselSlots();

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.galleryCarouselSlot.findUnique({
        where: { position },
        include: GALLERY_CAROUSEL_SLOT_INCLUDE,
      });
      if (!current) {
        throw new NotFoundException('Posición de carrusel no encontrada');
      }
      if (
        dto.expectedRevision !== undefined &&
        dto.expectedRevision !== current.revision
      ) {
        throw new ConflictException(
          'La posición ha cambiado. Recarga la galería antes de guardar.',
        );
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
            'Uno o más productos seleccionados no son válidos',
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

      const updated = await tx.galleryCarouselSlot.update({
        where: { position },
        data: {
          assetId: nextAssetId,
          itemId: nextAssetId
            ? current.assetId === nextAssetId && current.itemId
              ? current.itemId
              : randomUUID()
            : null,
          description: nextAssetId
            ? current.assetId === nextAssetId
              ? description === undefined
                ? current.description
                : description
              : (description ?? null)
            : null,
          relatedProductIds: nextAssetId
            ? current.assetId === nextAssetId
              ? (productIds ??
                this.carouselProductIds(current.relatedProductIds))
              : (productIds ?? [])
            : Prisma.DbNull,
          focalX: dto.focalX ?? current.focalX,
          focalY: dto.focalY ?? current.focalY,
          zoom: dto.zoom ?? current.zoom,
          revision: { increment: 1 },
          altText: nextAssetId ? altText : '',
          instagramUrl: nextAssetId ? instagramUrl : null,
        },
        include: GALLERY_CAROUSEL_SLOT_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action: 'gallery.carousel.slot.update',
          actionType: 'UPDATE',
          targetType: 'gallery-carousel-slot',
          targetId: String(position),
          metadata: {
            assetId: nextAssetId,
            focalX: updated.focalX,
            focalY: updated.focalY,
            zoom: updated.zoom,
            productCount: this.carouselProductIds(updated.relatedProductIds)
              .length,
          },
        },
      });
      const carouselProducts = await this.loadCarouselProducts([updated], tx);
      return { slot: this.toAdminCarouselSlot(updated, carouselProducts) };
    });
  }

  async reorderCarousel(dto: ReorderGalleryCarouselDto, adminId?: number) {
    const { sourcePosition, targetPosition } = dto;
    if (sourcePosition === targetPosition) {
      throw new BadRequestException(
        'La posición de origen y destino deben ser diferentes',
      );
    }
    await this.ensureCarouselSlots();
    return this.prisma.$transaction(
      async (tx) => {
        const slots = await tx.galleryCarouselSlot.findMany({
          orderBy: { position: 'asc' },
          include: GALLERY_CAROUSEL_SLOT_INCLUDE,
        });
        const sourceIndex = slots.findIndex(
          (slot) => slot.position === sourcePosition,
        );
        const targetIndex = slots.findIndex(
          (slot) => slot.position === targetPosition,
        );
        if (sourceIndex < 0 || targetIndex < 0) {
          throw new NotFoundException('Posición de carrusel no encontrada');
        }
        if (!slots[sourceIndex].assetId) {
          throw new BadRequestException(
            'La posición de origen no contiene ninguna foto',
          );
        }
        const content = slots.map((slot) => ({
          assetId: slot.assetId,
          itemId: slot.itemId,
          description: slot.description,
          relatedProductIds: slot.relatedProductIds ?? Prisma.DbNull,
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
        }));
        const [moved] = content.splice(sourceIndex, 1);
        content.splice(targetIndex, 0, moved);
        await Promise.all(
          slots
            .filter((slot) => slot.itemId)
            .map((slot) =>
              tx.galleryCarouselSlot.update({
                where: { position: slot.position },
                data: { itemId: randomUUID() },
              }),
            ),
        );
        await Promise.all(
          slots.map((slot, index) =>
            tx.galleryCarouselSlot.update({
              where: { position: slot.position },
              data: { ...content[index], revision: { increment: 1 } },
            }),
          ),
        );
        await tx.auditLog.create({
          data: {
            actorId: adminId ?? null,
            action: 'gallery.carousel.reorder',
            actionType: 'UPDATE',
            targetType: 'gallery-carousel',
            targetId: `${sourcePosition}:${targetPosition}`,
            metadata: { sourcePosition, targetPosition },
          },
        });
        const reordered = await tx.galleryCarouselSlot.findMany({
          orderBy: { position: 'asc' },
          include: GALLERY_CAROUSEL_SLOT_INCLUDE,
        });
        const carouselProducts = await this.loadCarouselProducts(reordered, tx);
        return {
          sourcePosition,
          targetPosition,
          carouselSlots: reordered.map((slot) =>
            this.toAdminCarouselSlot(slot, carouselProducts),
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
