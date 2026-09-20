import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  IMAGE_PRESETS,
  ImagePresetName,
  ImageVariantRole,
} from './image-presets';

export const MAX_IMAGE_PIXELS = 80_000_000;
export const MAX_MANAGED_IMAGE_RECOVERY_PIXELS = 120_000_000;

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
  private async inspectWithLimit(
    buffer: Buffer,
    limitInputPixels: number,
    managedRecovery = false,
  ) {
    try {
      const metadata = await sharp(buffer, {
        failOn: 'error',
        limitInputPixels,
        sequentialRead: true,
      }).metadata();
      if (!metadata.width || !metadata.height || !metadata.format) {
        throw new Error('Missing image metadata');
      }
      return metadata;
    } catch (error) {
      if (managedRecovery) {
        const detail =
          error instanceof Error ? error.message : 'error de decodificacion';
        throw new BadRequestException(
          `Original gestionado no procesable: ${detail} (limite seguro ${MAX_MANAGED_IMAGE_RECOVERY_PIXELS} pixeles).`,
        );
      }
      throw new BadRequestException(
        'Imagen no valida o con unas dimensiones demasiado grandes.',
      );
    }
  }

  async inspect(buffer: Buffer) {
    return this.inspectWithLimit(buffer, MAX_IMAGE_PIXELS);
  }

  async inspectManagedOriginal(buffer: Buffer) {
    return this.inspectWithLimit(
      buffer,
      MAX_MANAGED_IMAGE_RECOVERY_PIXELS,
      true,
    );
  }

  private async createVariant(
    buffer: Buffer,
    presetName: ImagePresetName,
    limitInputPixels: number,
  ): Promise<ProcessedImageVariant> {
    const preset = IMAGE_PRESETS[presetName];
    const { data, info } = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels,
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
  }

  async createVariants(
    buffer: Buffer,
    presets: readonly ImagePresetName[],
  ): Promise<ProcessedImageVariant[]> {
    await this.inspect(buffer);
    return Promise.all(
      presets.map((presetName) =>
        this.createVariant(buffer, presetName, MAX_IMAGE_PIXELS),
      ),
    );
  }

  async createManagedOriginalVariants(
    buffer: Buffer,
    presets: readonly ImagePresetName[],
  ): Promise<ProcessedImageVariant[]> {
    await this.inspectManagedOriginal(buffer);
    const variants: ProcessedImageVariant[] = [];
    for (const presetName of presets) {
      variants.push(
        await this.createVariant(
          buffer,
          presetName,
          MAX_MANAGED_IMAGE_RECOVERY_PIXELS,
        ),
      );
    }
    return variants;
  }
}
