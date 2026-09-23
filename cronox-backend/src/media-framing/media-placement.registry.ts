import { MediaFitMode } from '@prisma/client';

export type MediaFrame = Readonly<{
  focalX: number;
  focalY: number;
  zoom: number;
  fit: MediaFitMode;
}>;

export type MediaPlacementDefinition = Readonly<{
  key: string;
  label: string;
  route: string;
  publicUrl: string;
  category: string;
  mediaType: 'image' | 'video';
  sourceKind: 'static';
  staticSource: string;
  staticPoster?: string;
  libraryFolder: Readonly<{
    key: string;
    label: string;
  }>;
  frame: Readonly<{
    desktop: string;
    tablet: string;
    mobile: string;
  }>;
  preview: Readonly<{
    kind: 'viewport';
    tablet: Readonly<{ width: number; height: number }>;
    mobile: Readonly<{ width: number; height: number }>;
  }>;
  defaults: MediaFrame;
}>;

/**
 * Server-owned allowlist of structural/editorial media that belongs to the
 * website layout itself. Product and Gallery media have their own managers.
 */
export const MEDIA_PLACEMENTS: readonly MediaPlacementDefinition[] =
  Object.freeze([
    {
      key: 'home.hero.video',
      label: 'Imagen principal de portada',
      route: 'Portada (/)',
      publicUrl: '/',
      category: 'Portada',
      mediaType: 'image',
      sourceKind: 'static',
      staticSource: 'assets/logo_banner.png',
      libraryFolder: {
        key: 'portadas',
        label: 'PORTADAS',
      },
      frame: {
        desktop: 'Viewport actual',
        tablet: '768 \u00d7 1024',
        mobile: '390 \u00d7 844',
      },
      preview: {
        kind: 'viewport',
        tablet: { width: 768, height: 1024 },
        mobile: { width: 390, height: 844 },
      },
      defaults: {
        focalX: 50,
        focalY: 50,
        zoom: 1,
        fit: MediaFitMode.COVER,
      },
    },
  ] satisfies readonly MediaPlacementDefinition[]);

export const MEDIA_PLACEMENT_BY_KEY = new Map(
  MEDIA_PLACEMENTS.map((placement) => [placement.key, placement]),
);
