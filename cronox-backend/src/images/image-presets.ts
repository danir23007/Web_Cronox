export const IMAGE_PRESETS = Object.freeze({
  productCard: { role: 'card', dimension: 1300, quality: 94 },
  productQuick: { role: 'quick', dimension: 1800, quality: 95 },
  productPdp: { role: 'pdp', dimension: 3400, quality: 96 },
  smallProduct: { role: 'small', dimension: 600, quality: 93 },
  galleryGrid: { role: 'grid', dimension: 2000, quality: 95 },
  galleryLarge: { role: 'large', dimension: 3000, quality: 96 },
  heroDesktop: { role: 'desktop', dimension: 3000, quality: 96 },
  heroTablet: { role: 'tablet', dimension: 2200, quality: 95 },
  heroMobile: { role: 'mobile', dimension: 1600, quality: 95 },
});

export type ImagePresetName = keyof typeof IMAGE_PRESETS;
export type ImageVariantRole = (typeof IMAGE_PRESETS)[ImagePresetName]['role'];

export const PRODUCT_IMAGE_PRESETS: ImagePresetName[] = [
  'productCard',
  'productQuick',
  'productPdp',
  'smallProduct',
];
export const GALLERY_IMAGE_PRESETS: ImagePresetName[] = [
  'galleryGrid',
  'galleryLarge',
];
export const HERO_IMAGE_PRESETS: ImagePresetName[] = [
  'heroDesktop',
  'heroTablet',
  'heroMobile',
];

export type ImageVariantMetadata = {
  role: ImageVariantRole;
  url: string;
  storageKey: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
  fileSize: number;
};

export type ImageVariants = Partial<
  Record<ImageVariantRole, ImageVariantMetadata>
>;

export type MasterImageMetadata = {
  storageKey: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
  variants: ImageVariants;
};
