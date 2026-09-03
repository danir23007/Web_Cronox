/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from '@nestjs/common';
import {
  MAX_GALLERY_IMAGE_BYTES,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGE_COUNT,
  MAX_WEBSITE_MEDIA_BYTES,
  SupabaseStorageService,
} from './supabase-storage.service';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe('SupabaseStorageService', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalProductBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const originalGalleryBucket = process.env.SUPABASE_GALLERY_STORAGE_BUCKET;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://storage.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'product-images';
    process.env.SUPABASE_GALLERY_STORAGE_BUCKET = 'gallery';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;

    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;

    if (originalProductBucket === undefined)
      delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = originalProductBucket;

    if (originalGalleryBucket === undefined)
      delete process.env.SUPABASE_GALLERY_STORAGE_BUCKET;
    else process.env.SUPABASE_GALLERY_STORAGE_BUCKET = originalGalleryBucket;
  });

  it('rejects an image whose declared MIME type does not match its bytes', async () => {
    const service = new SupabaseStorageService();
    const forgedPng = {
      mimetype: 'image/png',
      buffer: Buffer.from('not an image'),
      size: 12,
      originalname: 'payload.png',
    } as Express.Multer.File;

    await expect(
      service.uploadProductImages([forgedPng]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps each upload request before accepting files', async () => {
    const service = new SupabaseStorageService();
    const image = {
      mimetype: 'image/png',
      buffer: PNG_SIGNATURE,
      size: PNG_SIGNATURE.length,
      originalname: 'image.png',
    } as Express.Multer.File;

    await expect(
      service.uploadProductImages(
        Array.from({ length: MAX_PRODUCT_IMAGE_COUNT + 1 }, () => image),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the validated MIME type, not an attacker-controlled filename, for stored objects', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as typeof fetch;
    const service = new SupabaseStorageService();
    const image = {
      mimetype: 'image/png',
      buffer: PNG_SIGNATURE,
      size: PNG_SIGNATURE.length,
      originalname: 'not-really-an-image.svg',
    } as Express.Multer.File;

    const result = await service.uploadProductImages([image]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/storage\/v1\/object\/product-images\/products\/.+\.png$/,
      ),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
      }),
    );
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0]).toMatch(/\.png$/);
  });

  it('stores gallery uploads in the non-destructive fotos-antiguas prefix', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as typeof fetch;
    const service = new SupabaseStorageService();
    const buffer = Buffer.alloc(24);
    PNG_SIGNATURE.copy(buffer);
    buffer.writeUInt32BE(1200, 16);
    buffer.writeUInt32BE(800, 20);
    const image = {
      mimetype: 'image/png',
      buffer,
      size: buffer.length,
      originalname: '../cliente-\u00f1.png',
    } as Express.Multer.File;

    const result = await service.uploadGalleryImage(image, 7);

    expect(result.storageKey).toMatch(
      /^fotos-antiguas\/\d{4}\/\d{2}\/.+\.png$/,
    );
    expect(result.publicUrl).toContain(
      `/storage/v1/object/public/gallery/${result.storageKey}`,
    );
    expect(result.originalFilename).toBe('cliente-_.png');
    expect(result.mimeType).toBe('image/png');
    expect(result).toMatchObject({ width: 1200, height: 800 });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/storage/v1/object/gallery/fotos-antiguas/'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'image/png',
          'x-upsert': 'false',
        }),
      }),
    );
  });

  it('accepts a valid gallery image at exactly 25 MB', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as typeof fetch;
    const service = new SupabaseStorageService();
    const buffer = Buffer.alloc(MAX_GALLERY_IMAGE_BYTES);
    PNG_SIGNATURE.copy(buffer);
    buffer.writeUInt32BE(1, 16);
    buffer.writeUInt32BE(1, 20);
    const image = {
      mimetype: 'image/png',
      buffer,
      size: buffer.length,
      originalname: 'exactly-25mb.png',
    } as Express.Multer.File;

    await expect(service.uploadGalleryImage(image)).resolves.toMatchObject({
      fileSize: 25 * 1024 * 1024,
      mimeType: 'image/png',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a gallery image one byte above 25 MB', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const service = new SupabaseStorageService();
    const buffer = Buffer.alloc(MAX_GALLERY_IMAGE_BYTES + 1);
    PNG_SIGNATURE.copy(buffer);
    const oversized = {
      mimetype: 'image/png',
      buffer,
      size: buffer.length,
      originalname: 'large.png',
    } as Express.Multer.File;

    await expect(service.uploadGalleryImage(oversized)).rejects.toThrow(
      '25 MB',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid byte signature below the gallery limit', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const service = new SupabaseStorageService();
    const forged = {
      mimetype: 'image/webp',
      buffer: PNG_SIGNATURE,
      size: PNG_SIGNATURE.length,
      originalname: 'forged.webp',
    } as Express.Multer.File;

    await expect(service.uploadGalleryImage(forged)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff]), 'photo.jpg'],
    ['image/png', PNG_SIGNATURE, 'photo.png'],
    [
      'image/webp',
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      'photo.webp',
    ],
  ])(
    'continues accepting valid %s gallery signatures',
    async (mimetype, buffer, originalname) => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as typeof fetch;
      const service = new SupabaseStorageService();
      const image = {
        mimetype,
        buffer,
        size: buffer.length,
        originalname,
      } as Express.Multer.File;

      await expect(service.uploadGalleryImage(image)).resolves.toMatchObject({
        mimeType: mimetype,
      });
    },
  );

  it('keeps the product image limit unchanged at 8 MB', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const service = new SupabaseStorageService();
    const image = {
      mimetype: 'image/png',
      buffer: PNG_SIGNATURE,
      size: MAX_PRODUCT_IMAGE_BYTES + 1,
      originalname: 'product-too-large.png',
    } as Express.Multer.File;

    expect(MAX_PRODUCT_IMAGE_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_GALLERY_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    await expect(service.uploadProductImages([image])).rejects.toThrow('8 MB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'image/png',
      (() => {
        const buffer = Buffer.alloc(24);
        PNG_SIGNATURE.copy(buffer);
        buffer.writeUInt32BE(1600, 16);
        buffer.writeUInt32BE(900, 20);
        return buffer;
      })(),
      'portada.png',
      'fotos',
      'image',
    ],
    [
      'video/mp4',
      Buffer.from([
        0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]),
      'portada.mp4',
      'videos',
      'video',
    ],
    [
      'video/webm',
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
      'portada.webm',
      'videos',
      'video',
    ],
  ])(
    'stores valid website %s files in their reusable PORTADAS subfolder',
    async (mimetype, buffer, originalname, subfolder, mediaType) => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as typeof fetch;
      const service = new SupabaseStorageService();
      const file = {
        mimetype,
        buffer,
        size: buffer.length,
        originalname,
      } as Express.Multer.File;

      const result = await service.uploadWebsiteMedia(file, 'portadas', 4);

      expect(result).toMatchObject({
        folderKey: 'portadas',
        mediaType,
        originalFilename: originalname,
      });
      expect(result.storageKey).toMatch(
        new RegExp(`^multimedia-web/portadas/${subfolder}/\\d{4}/\\d{2}/`),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          `/storage/v1/object/gallery/multimedia-web/portadas/${subfolder}/`,
        ),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': mimetype,
            'x-upsert': 'false',
          }),
        }),
      );
    },
  );

  it('rejects forged website videos and keeps the 100 MB request ceiling', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const service = new SupabaseStorageService();
    const forged = {
      mimetype: 'video/mp4',
      buffer: Buffer.from('not an mp4'),
      size: 10,
      originalname: 'forged.mp4',
    } as Express.Multer.File;

    expect(MAX_WEBSITE_MEDIA_BYTES).toBe(100 * 1024 * 1024);
    await expect(
      service.uploadWebsiteMedia(forged, 'portadas'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
