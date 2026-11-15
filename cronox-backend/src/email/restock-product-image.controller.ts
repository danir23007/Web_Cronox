import { Controller, Get, NotFoundException, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { trustedOrderImageUrl } from './managed/order-product-thumbnail';
import { restockQuickSource } from './managed/restock-photos';

/** Quick Add's full contain framing, baked into a PNG for email clients. */
export const createRestockPhoto = (source: Buffer) => sharp(source, { limitInputPixels: 40_000_000 }).rotate()
  .resize(560, 736, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

@Controller('email/restock-product-image')
export class RestockProductImageController {
  private readonly cache = new Map<string, Buffer>();
  constructor(private readonly db: PrismaService) {}

  @Get(':id.png')
  async image(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const record = await this.db.productImage.findFirst({ where: { id, isActive: true, archivedAt: null } });
    if (!record) throw new NotFoundException();
    const sources = [...new Set([restockQuickSource(record), record.url])].filter(trustedOrderImageUrl);
    if (!sources.length) throw new NotFoundException();
    const cacheKey = sources.join('\n');
    let buffer = this.cache.get(cacheKey);
    if (!buffer) {
      for (const source of sources) {
        try {
          const original = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(15000) });
          if (!original.ok || !original.body || Number(original.headers.get('content-length')) > 20_000_000) continue;
          const chunks: Uint8Array[] = []; let length = 0;
          for await (const chunk of original.body) {
            length += chunk.length; if (length > 20_000_000) throw new NotFoundException(); chunks.push(chunk);
          }
          buffer = await createRestockPhoto(Buffer.concat(chunks));
          break;
        } catch { /* Quick Add also falls back to this record's original. */ }
      }
      if (!buffer) throw new NotFoundException();
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, buffer);
    }
    response.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
  }
}
