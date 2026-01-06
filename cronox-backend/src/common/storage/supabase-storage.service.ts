import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { Express } from 'express';

type UploadResult = { urls: string[] };

@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly bucket = process.env.SUPABASE_STORAGE_BUCKET || 'products';
  private readonly supabaseUrl = process.env.SUPABASE_URL;
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  async uploadProductImages(files: Express.Multer.File[] = [], adminId?: number): Promise<UploadResult> {
    if (!Array.isArray(files) || !files.length) {
      throw new BadRequestException('No se recibieron archivos para subir');
    }

    if (!this.supabaseUrl || !this.serviceRoleKey) {
      this.logger.error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
      throw new InternalServerErrorException('Almacenamiento no configurado');
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    const invalid = files.find((file) => !allowed.includes(file.mimetype));
    if (invalid) {
      throw new BadRequestException('Formato de imagen no permitido. Usa JPEG, PNG o WEBP.');
    }

    const urls: string[] = [];

    for (const file of files) {
      const extension = this.resolveExtension(file.originalname);
      const path = this.buildObjectPath(extension);
      const response = await fetch(`${this.supabaseUrl}/storage/v1/object/${this.bucket}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': file.mimetype,
          'x-upsert': 'false',
        },
        body: file.buffer as unknown as BodyInit,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.error(
          `Falló la subida a Supabase (${response.status}): ${errorText}`,
          errorText,
        );
        throw new InternalServerErrorException('No se pudo subir la imagen');
      }

      const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${path}`;
      urls.push(publicUrl);
    }

    this.logger.log(
      `Subida de ${urls.length} imágenes a Supabase${adminId ? ` por admin ${adminId}` : ''}`,
    );
    return { urls };
  }

  private resolveExtension(filename: string) {
    const match = filename?.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1].toLowerCase() : 'jpg';
  }

  private buildObjectPath(extension: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = `${now.getUTCMonth() + 1}`.padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 8);
    const timestamp = now.getTime();
    return `products/${year}/${month}/${timestamp}-${rand}.${extension}`;
  }
}
