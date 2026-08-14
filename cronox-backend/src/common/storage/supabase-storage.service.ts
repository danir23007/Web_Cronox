import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';

type UploadResult = { urls: string[] };

export type GalleryUploadResult = {
  storageKey: string;
  publicUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
};

export const MAX_PRODUCT_IMAGE_COUNT = 8;
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_GALLERY_IMAGE_BYTES = 25 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const extensionForMimeType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly productBucket =
    process.env.SUPABASE_STORAGE_BUCKET || 'products';
  private readonly galleryBucket =
    process.env.SUPABASE_GALLERY_STORAGE_BUCKET || 'gallery';
  private readonly supabaseUrl = process.env.SUPABASE_URL;
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  async uploadProductImages(
    files: Express.Multer.File[] = [],
    adminId?: number,
  ): Promise<UploadResult> {
    if (!Array.isArray(files) || !files.length) {
      throw new BadRequestException('No se recibieron archivos para subir');
    }

    if (files.length > MAX_PRODUCT_IMAGE_COUNT) {
      throw new BadRequestException(
        `A maximum of ${MAX_PRODUCT_IMAGE_COUNT} images can be uploaded per request`,
      );
    }

    if (!this.supabaseUrl || !this.serviceRoleKey) {
      this.logger.error(
        'Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY',
      );
      throw new InternalServerErrorException('Almacenamiento no configurado');
    }

    const invalid = files.find((file) => {
      const byteLength = file.size ?? file.buffer?.length ?? 0;
      return (
        !ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ||
        !Buffer.isBuffer(file.buffer) ||
        byteLength <= 0 ||
        byteLength > MAX_PRODUCT_IMAGE_BYTES ||
        !this.hasExpectedImageSignature(file.buffer, file.mimetype)
      );
    });
    if (invalid) {
      throw new BadRequestException(
        'Invalid image. Only valid JPEG, PNG, or WEBP files up to 8 MB are allowed.',
      );
    }

    const urls: string[] = [];

    for (const file of files) {
      const extension = extensionForMimeType[file.mimetype];
      const path = this.buildObjectPath(extension);
      const response = await fetch(
        `${this.supabaseUrl}/storage/v1/object/${this.productBucket}/${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.serviceRoleKey}`,
            'Content-Type': file.mimetype,
            'x-upsert': 'false',
          },
          body: file.buffer as unknown as BodyInit,
        },
      );

      if (!response.ok) {
        // Do not include a third-party response body in application logs: it
        // is untrusted and can contain sensitive or log-forging content.
        this.logger.error(
          `Supabase image upload failed with status ${response.status}`,
        );
        throw new InternalServerErrorException('No se pudo subir la imagen');
      }

      const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${this.productBucket}/${path}`;
      urls.push(publicUrl);
    }

    this.logger.log(
      `Subida de ${urls.length} imagenes a Supabase${adminId ? ` por admin ${adminId}` : ''}`,
    );
    return { urls };
  }

  async uploadGalleryImage(
    file: Express.Multer.File | undefined,
    adminId?: number,
  ): Promise<GalleryUploadResult> {
    if (!file) {
      throw new BadRequestException('No se recibio una imagen para subir');
    }

    const byteLength = Buffer.isBuffer(file.buffer) ? file.buffer.length : 0;
    if (byteLength > MAX_GALLERY_IMAGE_BYTES) {
      throw new BadRequestException(
        'La imagen supera el tama\u00f1o m\u00e1ximo permitido de 25 MB.',
      );
    }
    if (
      !ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ||
      !Buffer.isBuffer(file.buffer) ||
      byteLength <= 0 ||
      !this.hasExpectedImageSignature(file.buffer, file.mimetype)
    ) {
      throw new BadRequestException(
        'Imagen no v\u00e1lida. Solo se permiten archivos JPEG, PNG o WebP v\u00e1lidos de hasta 25 MB.',
      );
    }

    if (!this.supabaseUrl || !this.serviceRoleKey) {
      this.logger.error(
        'Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY',
      );
      throw new InternalServerErrorException('Almacenamiento no configurado');
    }

    const extension = extensionForMimeType[file.mimetype];
    const storageKey = this.buildObjectPath(extension, 'fotos-antiguas');
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${this.galleryBucket}/${storageKey}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': file.mimetype,
          'x-upsert': 'false',
        },
        body: file.buffer as unknown as BodyInit,
      },
    );

    if (!response.ok) {
      this.logger.error(
        `Supabase gallery upload failed with status ${response.status}`,
      );
      throw new InternalServerErrorException('No se pudo subir la imagen');
    }

    const dimensions = this.readImageDimensions(file.buffer, file.mimetype);
    const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${this.galleryBucket}/${storageKey}`;
    this.logger.log(
      `Imagen de galeria subida a Supabase${adminId ? ` por admin ${adminId}` : ''}`,
    );

    return {
      storageKey,
      publicUrl,
      originalFilename: this.sanitizeOriginalFilename(file.originalname),
      mimeType: file.mimetype,
      fileSize: byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    };
  }

  private hasExpectedImageSignature(buffer: Buffer, mimeType: string) {
    if (mimeType === 'image/jpeg') {
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    }

    if (mimeType === 'image/png') {
      return (
        buffer.length >= 8 &&
        buffer
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    }

    if (mimeType === 'image/webp') {
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }

    return false;
  }

  private sanitizeOriginalFilename(value: string | undefined) {
    const basename = String(value || 'imagen')
      .split(/[\\/]/)
      .pop()
      ?.normalize('NFKC');
    const sanitized = String(basename || 'imagen')
      .split('')
      .filter((character) => {
        const codePoint = character.charCodeAt(0);
        return codePoint >= 32 && codePoint !== 127;
      })
      .join('')
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .replace(/\.{2,}/g, '.')
      .trim()
      .slice(0, 180);
    return sanitized || 'imagen';
  }

  private readImageDimensions(buffer: Buffer, mimeType: string) {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }

    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const blockLength = buffer.readUInt16BE(offset + 2);
        if (blockLength < 2) break;
        if (
          [
            0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
            0xce, 0xcf,
          ].includes(marker) &&
          offset + 8 < buffer.length
        ) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + blockLength;
      }
    }

    if (mimeType === 'image/webp' && buffer.length >= 30) {
      const chunk = buffer.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X') {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3),
        };
      }
      if (chunk === 'VP8 ' && buffer.length >= 30) {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
      if (chunk === 'VP8L' && buffer.length >= 25) {
        const b1 = buffer[21];
        const b2 = buffer[22];
        const b3 = buffer[23];
        const b4 = buffer[24];
        return {
          width: 1 + (((b2 & 0x3f) << 8) | b1),
          height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
        };
      }
    }

    return null;
  }

  private buildObjectPath(extension: string, prefix = 'products') {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = `${now.getUTCMonth() + 1}`.padStart(2, '0');
    return `${prefix}/${year}/${month}/${now.getTime()}-${randomUUID()}.${extension}`;
  }
}
