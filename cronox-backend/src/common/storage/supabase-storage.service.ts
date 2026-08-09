import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';

type UploadResult = { urls: string[] };

export const MAX_PRODUCT_IMAGE_COUNT = 8;
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;

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
  private readonly bucket = process.env.SUPABASE_STORAGE_BUCKET || 'products';
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
      this.logger.error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
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
        `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${path}`,
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
        this.logger.error(`Supabase image upload failed with status ${response.status}`);
        throw new InternalServerErrorException('No se pudo subir la imagen');
      }

      const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${path}`;
      urls.push(publicUrl);
    }

    this.logger.log(
      `Subida de ${urls.length} imagenes a Supabase${adminId ? ` por admin ${adminId}` : ''}`,
    );
    return { urls };
  }

  private hasExpectedImageSignature(buffer: Buffer, mimeType: string) {
    if (mimeType === 'image/jpeg') {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
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

  private buildObjectPath(extension: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = `${now.getUTCMonth() + 1}`.padStart(2, '0');
    return `products/${year}/${month}/${now.getTime()}-${randomUUID()}.${extension}`;
  }
}
