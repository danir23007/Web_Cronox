import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Express } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { ImageProcessorService } from '../../images/image-processor.service';
import {
  GALLERY_IMAGE_PRESETS,
  HERO_IMAGE_PRESETS,
  ImagePresetName,
  ImageVariants,
  MasterImageMetadata,
  PRODUCT_IMAGE_PRESETS,
} from '../../images/image-presets';

type UploadResult = { urls: string[]; images: MasterImageMetadata[] };

export type GalleryUploadResult = {
  storageKey: string;
  publicUrl: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  variants: ImageVariants;
};

export type WebsiteMediaUploadResult = GalleryUploadResult & {
  mediaType: 'image' | 'video';
  folderKey: string;
};

export const MAX_PRODUCT_IMAGE_COUNT = 8;
export const MAX_PRODUCT_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_GALLERY_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_WEBSITE_MEDIA_BYTES = 100 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const extensionForMimeType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

const ALLOWED_WEBSITE_MEDIA_MIME_TYPES = new Set([
  ...ALLOWED_IMAGE_MIME_TYPES,
  'video/mp4',
  'video/webm',
]);

@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly productBucket =
    process.env.SUPABASE_STORAGE_BUCKET || 'products';
  private readonly galleryBucket =
    process.env.SUPABASE_GALLERY_STORAGE_BUCKET || 'gallery';
  private readonly websiteMediaBucket =
    process.env.SUPABASE_WEBSITE_MEDIA_STORAGE_BUCKET ||
    process.env.SUPABASE_GALLERY_STORAGE_BUCKET ||
    'gallery';
  private readonly supabaseUrl = process.env.SUPABASE_URL;
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  constructor(
    private readonly imageProcessor: ImageProcessorService = new ImageProcessorService(),
  ) {}

  private publicUrl(bucket: string, storageKey: string) {
    return `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${storageKey}`;
  }

  private imageIdentity(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private async uploadObject(
    bucket: string,
    storageKey: string,
    buffer: Buffer,
    mimeType: string,
    immutable = false,
  ) {
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${bucket}/${storageKey}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': mimeType,
          ...(immutable ? { 'Cache-Control': '31536000' } : {}),
          'x-upsert': 'false',
        },
        body: buffer as unknown as BodyInit,
      },
    );
    // Immutable, content-addressed paths make a conflict an idempotent success.
    if (!response.ok && response.status !== 409) {
      this.logger.error(
        `Supabase image upload failed status=${response.status} bucket=${bucket}`,
      );
      throw new InternalServerErrorException('No se pudo subir la imagen');
    }
    return response.ok;
  }

  private async uploadOptimizedImage(
    file: Express.Multer.File,
    bucket: string,
    prefix: string,
    presets: readonly ImagePresetName[],
  ): Promise<MasterImageMetadata> {
    const metadata = await this.imageProcessor.inspect(file.buffer);
    const derivatives = await this.imageProcessor.createVariants(
      file.buffer,
      presets,
    );
    const identity = this.imageIdentity(file.buffer);
    const extension = extensionForMimeType[file.mimetype];
    const storageKey = `${prefix}/originals/${identity}.${extension}`;

    await this.uploadObject(
      bucket,
      storageKey,
      file.buffer,
      file.mimetype,
      true,
    );

    const variants: ImageVariants = {};
    const uploadedVariantKeys: string[] = [];
    try {
      for (const derivative of derivatives) {
        const variantKey = `${prefix}/variants/${identity}/${derivative.role}.webp`;
        const created = await this.uploadObject(
          bucket,
          variantKey,
          derivative.buffer,
          derivative.mimeType,
          true,
        );
        if (created) uploadedVariantKeys.push(variantKey);
        variants[derivative.role] = {
          role: derivative.role,
          url: this.publicUrl(bucket, variantKey),
          storageKey: variantKey,
          mimeType: derivative.mimeType,
          width: derivative.width,
          height: derivative.height,
          fileSize: derivative.fileSize,
        };
        if (process.env.NODE_ENV !== 'production') {
          const savings = Math.round(
            (1 - derivative.fileSize / file.buffer.length) * 100,
          );
          this.logger.debug(
            `Image derivative preset=${derivative.preset} original=${metadata.autoOrient.width ?? metadata.width}x${metadata.autoOrient.height ?? metadata.height}/${file.buffer.length}B output=${derivative.width}x${derivative.height}/${derivative.fileSize}B savings=${savings}%`,
          );
        }
      }
    } catch (error) {
      // The original is deliberately preserved. Only this attempt's derivative
      // paths are eligible for cleanup, and metadata is never returned/persisted.
      await this.deleteObjectPaths(bucket, uploadedVariantKeys).catch(
        () => undefined,
      );
      throw error;
    }

    return {
      storageKey,
      url: this.publicUrl(bucket, storageKey),
      mimeType: file.mimetype,
      width: metadata.autoOrient.width ?? metadata.width,
      height: metadata.autoOrient.height ?? metadata.height,
      fileSize: file.buffer.length,
      variants,
    };
  }

  async backfillManagedImage(options: {
    url: string;
    bucket: string;
    prefix: string;
    presets: readonly ImagePresetName[];
    execute: boolean;
  }) {
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new Error('Almacenamiento no configurado');
    }
    const parsed = new URL(options.url);
    const base = new URL(this.supabaseUrl);
    const publicPrefix = `/storage/v1/object/public/${options.bucket}/`;
    if (
      parsed.origin !== base.origin ||
      !parsed.pathname.startsWith(publicPrefix)
    ) {
      throw new Error('La URL maestra no pertenece al bucket esperado');
    }
    const response = await fetch(parsed);
    if (!response.ok)
      throw new Error(`No se pudo leer el original (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await this.imageProcessor.inspect(buffer);
    const derivatives = await this.imageProcessor.createVariants(
      buffer,
      options.presets,
    );
    const identity = this.imageIdentity(buffer);
    const variants: ImageVariants = {};
    for (const derivative of derivatives) {
      const storageKey = `${options.prefix}/variants/${identity}/${derivative.role}.webp`;
      if (options.execute) {
        await this.uploadObject(
          options.bucket,
          storageKey,
          derivative.buffer,
          derivative.mimeType,
          true,
        );
      }
      variants[derivative.role] = {
        role: derivative.role,
        storageKey,
        url: this.publicUrl(options.bucket, storageKey),
        mimeType: derivative.mimeType,
        width: derivative.width,
        height: derivative.height,
        fileSize: derivative.fileSize,
      };
    }
    return {
      variants,
      width: metadata.autoOrient.width ?? metadata.width,
      height: metadata.autoOrient.height ?? metadata.height,
      originalBytes: buffer.length,
      derivativeBytes: derivatives.reduce(
        (total, item) => total + item.fileSize,
        0,
      ),
    };
  }

  getBuckets() {
    return {
      products: this.productBucket,
      gallery: this.galleryBucket,
      websiteMedia: this.websiteMediaBucket,
    };
  }

  async uploadEmailImage(
    file: Express.Multer.File | undefined,
    senderKey: string,
  ) {
    if (
      !/^(SUPPORT|ORDERS|NOREPLY|INFO)$/.test(senderKey) ||
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length > 5 * 1024 * 1024 ||
      !ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ||
      !this.hasExpectedImageSignature(file.buffer, file.mimetype)
    ) {
      throw new BadRequestException(
        'Imagen no válida. Usa JPEG, PNG o WebP de hasta 5 MB.',
      );
    }
    const dimensions = this.readImageDimensions(file.buffer, file.mimetype);
    if (
      !dimensions ||
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > 4096 ||
      dimensions.height > 4096
    )
      throw new BadRequestException(
        'Dimensiones no válidas: máximo 4096 × 4096 píxeles.',
      );
    if (!this.supabaseUrl?.startsWith('https://') || !this.serviceRoleKey)
      throw new InternalServerErrorException(
        'Almacenamiento de correo no configurado.',
      );
    const bucket =
      process.env.SUPABASE_EMAIL_STORAGE_BUCKET ||
      process.env.SUPABASE_GALLERY_STORAGE_BUCKET ||
      'gallery';
    if (!/^[a-zA-Z0-9_-]+$/.test(bucket))
      throw new InternalServerErrorException(
        'Almacenamiento de correo no configurado.',
      );
    const storageKey = this.buildObjectPath(
      extensionForMimeType[file.mimetype],
      `${senderKey}/images`,
    );
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${bucket}/${storageKey}`,
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
        `Fallo de almacenamiento de imagen de correo. status=${response.status} bucket=${bucket} sender=${senderKey}`,
      );
      if (response.status === 404)
        throw new ServiceUnavailableException(
          'El almacenamiento de imágenes no está disponible.',
        );
      if (response.status === 401 || response.status === 403)
        throw new ServiceUnavailableException(
          'El servicio de imágenes no está autorizado correctamente.',
        );
      if (response.status === 413)
        throw new BadRequestException(
          'La imagen supera el tamaño permitido por el almacenamiento.',
        );
      throw new ServiceUnavailableException(
        'El servicio de imágenes no pudo completar la subida.',
      );
    }
    return {
      url: `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${storageKey}`,
      storageKey,
      mimeType: file.mimetype,
      fileSize: file.buffer.length,
      ...dimensions,
    };
  }

  async uploadProductImages(
    files: Express.Multer.File[] = [],
    adminId?: number,
  ): Promise<UploadResult> {
    if (!Array.isArray(files) || !files.length) {
      throw new BadRequestException('No se recibieron archivos para subir');
    }

    const oversized = files.find((file) => {
      const byteLength = Buffer.isBuffer(file.buffer)
        ? file.buffer.length
        : (file.size ?? 0);
      return byteLength > MAX_PRODUCT_IMAGE_BYTES;
    });
    if (oversized) {
      throw new BadRequestException(
        'Cada imagen puede pesar como m\u00e1ximo 25 MB.',
      );
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
      const byteLength = Buffer.isBuffer(file.buffer)
        ? file.buffer.length
        : (file.size ?? 0);
      return (
        !ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ||
        !Buffer.isBuffer(file.buffer) ||
        byteLength <= 0 ||
        !this.hasExpectedImageSignature(file.buffer, file.mimetype)
      );
    });
    if (invalid) {
      throw new BadRequestException(
        'Imagen no v\u00e1lida. Solo se permiten archivos JPEG, PNG o WebP v\u00e1lidos.',
      );
    }

    const images: MasterImageMetadata[] = [];
    for (const file of files) {
      images.push(
        await this.uploadOptimizedImage(
          file,
          this.productBucket,
          'products',
          PRODUCT_IMAGE_PRESETS,
        ),
      );
    }
    const urls = images.map((image) => image.url);

    this.logger.log(
      `Subida de ${urls.length} imagenes a Supabase${adminId ? ` por admin ${adminId}` : ''}`,
    );
    return { urls, images };
  }

  async deleteProductImages(urls: string[]): Promise<void> {
    const objectPaths = [...new Set(urls)]
      .map((url) => this.productObjectPath(url))
      .filter((path): path is string => Boolean(path));
    if (!objectPaths.length) return;
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new Error('Almacenamiento de productos no configurado');
    }

    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${this.productBucket}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: objectPaths }),
      },
    );
    if (!response.ok) {
      this.logger.error(
        `Supabase product cleanup failed with status ${response.status}`,
      );
      throw new Error('No se pudieron limpiar los archivos del producto');
    }
  }

  async deleteProductImageAssets(
    urls: string[],
    variants: Array<ImageVariants | null | undefined> = [],
  ): Promise<void> {
    const originalPaths = urls
      .map((url) => this.productObjectPath(url))
      .filter((path): path is string => Boolean(path));
    const variantPaths = variants.flatMap((record) =>
      Object.values(record || {})
        .map((variant) => variant?.storageKey)
        .filter((path): path is string =>
          Boolean(
            path &&
              /^products\/variants\/[a-f0-9]{64}\/[a-z]+\.webp$/.test(path),
          ),
        ),
    );
    await this.deleteObjectPaths(this.productBucket, [
      ...new Set([...originalPaths, ...variantPaths]),
    ]);
  }

  private async deleteObjectPaths(bucket: string, objectPaths: string[]) {
    if (!objectPaths.length) return;
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new Error('Almacenamiento no configurado');
    }
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${bucket}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: objectPaths }),
      },
    );
    if (!response.ok) throw new Error('No se pudieron limpiar los archivos');
  }

  isManagedProductImage(value: string): boolean {
    return Boolean(this.productObjectPath(value));
  }

  private productObjectPath(value: string): string | null {
    try {
      if (!this.supabaseUrl) return null;
      const url = new URL(value);
      const base = new URL(this.supabaseUrl);
      const prefix = `/storage/v1/object/public/${this.productBucket}/`;
      if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) {
        return null;
      }
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      return path && !path.split('/').includes('..') ? path : null;
    } catch {
      return null;
    }
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

    const optimized = await this.uploadOptimizedImage(
      file,
      this.galleryBucket,
      'fotos-antiguas',
      GALLERY_IMAGE_PRESETS,
    );
    this.logger.log(
      `Imagen de galeria subida a Supabase${adminId ? ` por admin ${adminId}` : ''}`,
    );

    return {
      storageKey: optimized.storageKey,
      publicUrl: optimized.url,
      originalFilename: this.sanitizeOriginalFilename(file.originalname),
      mimeType: file.mimetype,
      fileSize: byteLength,
      width: optimized.width,
      height: optimized.height,
      variants: optimized.variants,
    };
  }

  async uploadWebsiteMedia(
    file: Express.Multer.File | undefined,
    folderKey: string,
    adminId?: number,
  ): Promise<WebsiteMediaUploadResult> {
    if (!file) {
      throw new BadRequestException('No se recibió un archivo para subir');
    }

    const normalizedFolder = String(folderKey || '').toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(normalizedFolder)) {
      throw new BadRequestException('La carpeta multimedia no es válida');
    }

    const byteLength = Buffer.isBuffer(file.buffer) ? file.buffer.length : 0;
    const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
    const sizeLimit =
      mediaType === 'video' ? MAX_WEBSITE_MEDIA_BYTES : MAX_GALLERY_IMAGE_BYTES;
    if (byteLength > sizeLimit) {
      throw new BadRequestException(
        mediaType === 'video'
          ? 'El vídeo supera el tamaño máximo permitido de 100 MB.'
          : 'La imagen supera el tamaño máximo permitido de 25 MB.',
      );
    }
    if (
      !ALLOWED_WEBSITE_MEDIA_MIME_TYPES.has(file.mimetype) ||
      !Buffer.isBuffer(file.buffer) ||
      byteLength <= 0 ||
      !this.hasExpectedWebsiteMediaSignature(file.buffer, file.mimetype)
    ) {
      throw new BadRequestException(
        'Archivo no válido. Solo se permiten JPEG, PNG, WebP, MP4 o WebM válidos.',
      );
    }

    if (!this.supabaseUrl || !this.serviceRoleKey) {
      this.logger.error(
        'Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY',
      );
      throw new InternalServerErrorException('Almacenamiento no configurado');
    }

    const extension = extensionForMimeType[file.mimetype];
    const kindFolder = mediaType === 'video' ? 'videos' : 'fotos';
    if (mediaType === 'image') {
      const optimized = await this.uploadOptimizedImage(
        file,
        this.websiteMediaBucket,
        `multimedia-web/${normalizedFolder}/${kindFolder}`,
        HERO_IMAGE_PRESETS,
      );
      return {
        storageKey: optimized.storageKey,
        publicUrl: optimized.url,
        originalFilename: this.sanitizeOriginalFilename(file.originalname),
        mimeType: file.mimetype,
        mediaType,
        folderKey: normalizedFolder,
        fileSize: byteLength,
        width: optimized.width,
        height: optimized.height,
        variants: optimized.variants,
      };
    }
    const storageKey = this.buildObjectPath(
      extension,
      `multimedia-web/${normalizedFolder}/${kindFolder}`,
    );
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${this.websiteMediaBucket}/${storageKey}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': file.mimetype,
          'Cache-Control': '31536000',
          'x-upsert': 'false',
        },
        body: file.buffer as unknown as BodyInit,
      },
    );

    if (!response.ok) {
      this.logger.error(
        `Supabase website media upload failed with status ${response.status}`,
      );
      throw new InternalServerErrorException(
        'No se pudo subir el archivo multimedia',
      );
    }

    const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${this.websiteMediaBucket}/${storageKey}`;
    this.logger.log(
      `Multimedia web subida a Supabase${adminId ? ` por admin ${adminId}` : ''}`,
    );

    return {
      storageKey,
      publicUrl,
      originalFilename: this.sanitizeOriginalFilename(file.originalname),
      mimeType: file.mimetype,
      mediaType,
      folderKey: normalizedFolder,
      fileSize: byteLength,
      width: null,
      height: null,
      variants: {},
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

  private hasExpectedWebsiteMediaSignature(buffer: Buffer, mimeType: string) {
    if (ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      return this.hasExpectedImageSignature(buffer, mimeType);
    }
    if (mimeType === 'video/mp4') {
      return (
        buffer.length >= 12 &&
        buffer.subarray(4, 8).toString('ascii') === 'ftyp'
      );
    }
    if (mimeType === 'video/webm') {
      return (
        buffer.length >= 4 &&
        buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
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
