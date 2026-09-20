import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  IMAGE_PRESETS,
  ImagePresetName,
  ImageVariantRole,
} from './image-presets';

export const MAX_IMAGE_PIXELS = 80_000_000;

export type ProcessedImageVariant = {
  preset: ImagePresetName;
  role: ImageVariantRole;
  buffer: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
  fileSize: number;
  quality: number;
};

@Injectable()
export class ImageProcessorService {
  async inspect(buffer: Buffer) {
    try {
      const metadata = await sharp(buffer, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
        sequentialRead: true,
      }).metadata();
      if (!metadata.width || !metadata.height || !metadata.format) {
        throw new Error('Missing image metadata');
      }
      return metadata;
    } catch {
      throw new BadRequestException(
        'Imagen no valida o con unas dimensiones demasiado grandes.',
      );
    }
  }

  async createVariants(
    buffer: Buffer,
    presets: readonly ImagePresetName[],
  ): Promise<ProcessedImageVariant[]> {
    await this.inspect(buffer);
    return Promise.all(
      presets.map(async (presetName) => {
        const preset = IMAGE_PRESETS[presetName];
        const { data, info } = await sharp(buffer, {
          failOn: 'error',
          limitInputPixels: MAX_IMAGE_PIXELS,
          sequentialRead: true,
        })
          .rotate()
          .resize({
            width: preset.dimension,
            height: preset.dimension,
            fit: 'inside',
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
          })
          .toColourspace('srgb')
          .webp({
            quality: preset.quality,
            alphaQuality: 100,
            smartSubsample: true,
          })
          .toBuffer({ resolveWithObject: true });

        return {
          preset: presetName,
          role: preset.role,
          buffer: data,
          mimeType: 'image/webp' as const,
          width: info.width,
          height: info.height,
          fileSize: info.size,
          quality: preset.quality,
        };
      }),
    );
  }
}
