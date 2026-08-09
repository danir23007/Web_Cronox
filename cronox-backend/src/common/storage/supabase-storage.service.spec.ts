import { BadRequestException } from '@nestjs/common';
import {
  MAX_PRODUCT_IMAGE_COUNT,
  SupabaseStorageService,
} from './supabase-storage.service';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe('SupabaseStorageService', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://storage.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;

    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('rejects an image whose declared MIME type does not match its bytes', async () => {
    const service = new SupabaseStorageService();
    const forgedPng = {
      mimetype: 'image/png',
      buffer: Buffer.from('not an image'),
      size: 12,
      originalname: 'payload.png',
    } as Express.Multer.File;

    await expect(service.uploadProductImages([forgedPng])).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
      service.uploadProductImages(Array.from({ length: MAX_PRODUCT_IMAGE_COUNT + 1 }, () => image)),
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
      expect.stringMatching(/\.png$/),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
      }),
    );
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0]).toMatch(/\.png$/);
  });
});
