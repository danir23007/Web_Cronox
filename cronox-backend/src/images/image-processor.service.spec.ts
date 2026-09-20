import sharp from 'sharp';
import { ImageProcessorService } from './image-processor.service';

describe('ImageProcessorService', () => {
  const service = new ImageProcessorService();

  it.each([
    [
      'png',
      () =>
        sharp({
          create: {
            width: 1200,
            height: 800,
            channels: 4,
            background: { r: 30, g: 50, b: 70, alpha: 0.4 },
          },
        })
          .png()
          .toBuffer(),
    ],
    [
      'jpeg',
      () =>
        sharp({
          create: {
            width: 1200,
            height: 800,
            channels: 3,
            background: '#345678',
          },
        })
          .jpeg({ quality: 100 })
          .toBuffer(),
    ],
    [
      'webp',
      () =>
        sharp({
          create: {
            width: 1200,
            height: 800,
            channels: 4,
            background: { r: 30, g: 50, b: 70, alpha: 1 },
          },
        })
          .webp({ quality: 100 })
          .toBuffer(),
    ],
  ])('creates a valid WebP derivative from %s', async (_format, fixture) => {
    const [result] = await service.createVariants(await fixture(), [
      'productCard',
    ]);
    const metadata = await sharp(result.buffer).metadata();
    expect(result.mimeType).toBe('image/webp');
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(800);
  });

  it('preserves transparency, aspect ratio and exact canvas bounds', async () => {
    const source = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const [result] = await service.createVariants(source, ['productCard']);
    const metadata = await sharp(result.buffer).metadata();
    const corner = await sharp(result.buffer).ensureAlpha().raw().toBuffer();
    expect(metadata).toMatchObject({
      width: 1300,
      height: 650,
      hasAlpha: true,
    });
    expect(corner[3]).toBe(0);
  });

  it('never upscales a small master', async () => {
    const source = await sharp({
      create: { width: 320, height: 480, channels: 3, background: '#222222' },
    })
      .png()
      .toBuffer();
    const results = await service.createVariants(source, [
      'productPdp',
      'galleryLarge',
    ]);
    expect(results.map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 320, height: 480 },
      { width: 320, height: 480 },
    ]);
  });

  it('normalizes EXIF orientation before resize', async () => {
    const source = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#123456' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const [result] = await service.createVariants(source, ['smallProduct']);
    expect(result).toMatchObject({ width: 400, height: 600 });
  });

  it('rejects invalid input without producing output', async () => {
    await expect(
      service.createVariants(Buffer.from('not-an-image'), ['productCard']),
    ).rejects.toThrow('Imagen no valida');
  });
});
