import { Controller, Get, NotFoundException, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { createOrderProductThumbnail, trustedOrderImageUrl } from './managed/order-product-thumbnail';

@Controller('email/order-product-image')
export class OrderProductImageController {
  private readonly cache = new Map<string, Buffer>();
  constructor(private readonly db: PrismaService) {}

  @Get(':id.png')
  async image(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const image = await this.db.productImage.findFirst({ where: { id, isActive: true, archivedAt: null } });
    if (!image || !trustedOrderImageUrl(image.url)) throw new NotFoundException();
    let buffer = this.cache.get(image.url);
    if (!buffer) {
      // Only the configured public catalogue bucket, no redirects, credentials
      // or arbitrary client-supplied URL. Limit both encoded and decoded sizes.
      const original = await fetch(image.url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!original.ok || Number(original.headers.get('content-length')) > 20_000_000) throw new NotFoundException();
      const chunks: Uint8Array[] = []; let length = 0;
      for await (const chunk of original.body!) { length += chunk.length; if (length > 20_000_000) throw new NotFoundException(); chunks.push(chunk); }
      buffer = (await createOrderProductThumbnail(Buffer.concat(chunks))).buffer;
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(image.url, buffer);
    }
    response.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
  }
}
