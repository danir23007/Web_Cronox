import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../app.module';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  GALLERY_IMAGE_PRESETS,
  HERO_IMAGE_PRESETS,
  ImagePresetName,
  PRODUCT_IMAGE_PRESETS,
} from './image-presets';

type Summary = {
  scanned: number;
  skipped: number;
  generated: number;
  failed: number;
  originalTotalBytes: number;
  generatedDerivativeBytes: number;
};

const integerArg = (name: string, fallback: number) => {
  const match = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`),
  );
  const parsed = Number(match?.split('=')[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const optionalIdArg = (name: string) => {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
  if (!value) return undefined;
  if (!/^[a-z0-9]{10,40}$/.test(value)) {
    throw new Error(`El valor de --${name} no es valido.`);
  }
  return value;
};

const hasAllRoles = (
  variants: unknown,
  presets: readonly ImagePresetName[],
) => {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants))
    return false;
  const roles = new Set(
    presets.map(
      (preset) =>
        ({
          productCard: 'card',
          productQuick: 'quick',
          productPdp: 'pdp',
          smallProduct: 'small',
          galleryGrid: 'grid',
          galleryLarge: 'large',
          heroDesktop: 'desktop',
          heroTablet: 'tablet',
          heroMobile: 'mobile',
        })[preset],
    ),
  );
  return [...roles].every((role) =>
    Boolean((variants as Record<string, unknown>)[role]),
  );
};

async function main() {
  const execute = process.argv.includes('--execute');
  if (execute === process.argv.includes('--dry-run')) {
    throw new Error('Usa exactamente uno de --dry-run o --execute.');
  }
  const batchSize = Math.min(integerArg('batch-size', 20), 100);
  const concurrency = Math.min(integerArg('concurrency', 2), 4);
  const websiteMediaId = optionalIdArg('website-media-id');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const prisma = app.get(PrismaService);
  const storage = app.get(SupabaseStorageService);
  const buckets = storage.getBuckets();
  const summary: Summary = {
    scanned: 0,
    skipped: 0,
    generated: 0,
    failed: 0,
    originalTotalBytes: 0,
    generatedDerivativeBytes: 0,
  };

  const run = async (
    label: string,
    records: Array<{
      id: string | number;
      url: string;
      variants: unknown;
      mimeType?: string;
    }>,
    bucket: string,
    prefix: (record: { id: string | number }) => string,
    presets: readonly ImagePresetName[],
    update: (
      id: string | number,
      result: Awaited<ReturnType<typeof storage.backfillManagedImage>>,
    ) => Promise<unknown>,
    allowLargeManagedOriginal = false,
  ) => {
    for (let offset = 0; offset < records.length; offset += concurrency) {
      await Promise.all(
        records.slice(offset, offset + concurrency).map(async (record) => {
          summary.scanned += 1;
          if (hasAllRoles(record.variants, presets)) {
            summary.skipped += 1;
            return;
          }
          try {
            const result = await storage.backfillManagedImage({
              url: record.url,
              bucket,
              prefix: prefix(record),
              presets,
              execute,
              declaredMimeType: record.mimeType,
              allowLargeManagedOriginal,
            });
            summary.originalTotalBytes += result.originalBytes;
            summary.generatedDerivativeBytes += result.derivativeBytes;
            if (execute) await update(record.id, result);
            summary.generated += 1;
            process.stdout.write(
              `${execute ? 'generated' : 'would-generate'} ${label}:${record.id}\n`,
            );
          } catch (error) {
            summary.failed += 1;
            process.stderr.write(
              `failed ${label}:${record.id} ${error instanceof Error ? error.message : 'unknown'}\n`,
            );
          }
        }),
      );
    }
  };

  try {
    let cursor = 0;
    while (!websiteMediaId) {
      const records = await prisma.productImage.findMany({
        where: { id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: { id: true, url: true, variants: true },
      });
      if (!records.length) break;
      await run(
        'product',
        records,
        buckets.products,
        () => 'products',
        PRODUCT_IMAGE_PRESETS,
        (id, result) =>
          prisma.productImage.update({
            where: { id: Number(id) },
            data: {
              variants: result.variants as Prisma.InputJsonValue,
              width: result.width,
              height: result.height,
            },
          }),
      );
      cursor = records.at(-1)!.id;
    }

    let galleryCursor: string | undefined;
    while (!websiteMediaId) {
      const records = await prisma.galleryAsset.findMany({
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(galleryCursor ? { cursor: { id: galleryCursor }, skip: 1 } : {}),
        select: { id: true, publicUrl: true, variants: true },
      });
      if (!records.length) break;
      await run(
        'gallery',
        records.map((item) => ({
          id: item.id,
          url: item.publicUrl,
          variants: item.variants,
        })),
        buckets.gallery,
        () => 'fotos-antiguas',
        GALLERY_IMAGE_PRESETS,
        (id, result) =>
          prisma.galleryAsset.update({
            where: { id: String(id) },
            data: {
              variants: result.variants as Prisma.InputJsonValue,
              width: result.width,
              height: result.height,
            },
          }),
      );
      galleryCursor = records.at(-1)!.id;
    }

    let mediaCursor: string | undefined;
    while (true) {
      const records = await prisma.websiteMediaAsset.findMany({
        where: {
          mediaType: 'image',
          ...(websiteMediaId ? { id: websiteMediaId } : {}),
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(mediaCursor ? { cursor: { id: mediaCursor }, skip: 1 } : {}),
        select: {
          id: true,
          publicUrl: true,
          folderKey: true,
          mimeType: true,
          variants: true,
        },
      });
      if (!records.length) break;
      await run(
        'website-media',
        records.map((item) => ({
          id: item.id,
          url: item.publicUrl,
          variants: item.variants,
          folderKey: item.folderKey,
          mimeType: item.mimeType,
        })),
        buckets.websiteMedia,
        (record) => {
          const item = records.find((candidate) => candidate.id === record.id)!;
          return `multimedia-web/${item.folderKey}/fotos`;
        },
        HERO_IMAGE_PRESETS,
        (id, result) =>
          prisma.websiteMediaAsset.update({
            where: { id: String(id) },
            data: {
              variants: result.variants as Prisma.InputJsonValue,
              width: result.width,
              height: result.height,
            },
          }),
        true,
      );
      if (websiteMediaId) break;
      mediaCursor = records.at(-1)!.id;
    }
  } finally {
    process.stdout.write(
      `${JSON.stringify({ mode: execute ? 'execute' : 'dry-run', ...summary }, null, 2)}\n`,
    );
    await app.close();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Backfill failed'}\n`,
  );
  process.exitCode = 1;
});
