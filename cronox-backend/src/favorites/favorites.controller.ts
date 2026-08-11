import { Body, Controller, Delete, Get, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerActivityEventType } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { FavoritesService } from './favorites.service';
import { AnalyticsService } from '../analytics/analytics.service';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(
    private readonly favoritesService: FavoritesService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  @Get()
  async list(@CurrentUser('id') userId: number) {
    return this.favoritesService.list(userId);
  }

  @Get('products')
  async listProducts(@CurrentUser('id') userId: number) {
    return this.favoritesService.listProducts(userId);
  }

  @Post()
  async add(@CurrentUser('id') userId: number, @Req() req: Request, @Body() dto: AddFavoriteDto) {
    const result = await this.favoritesService.add(userId, dto);
    if (result.created) {
      void this.analytics?.recordServerEvent(req, userId, CustomerActivityEventType.FAVOURITE_ADDED, { productId: result.productId }).catch(() => undefined);
    }
    return result;
  }

  @Post('toggle')
  async toggle(@CurrentUser('id') userId: number, @Req() req: Request, @Body() dto: AddFavoriteDto) {
    const result = await this.favoritesService.toggle(userId, dto);
    void this.analytics?.recordServerEvent(
      req,
      userId,
      result.isFavorite ? CustomerActivityEventType.FAVOURITE_ADDED : CustomerActivityEventType.FAVOURITE_REMOVED,
      { productId: result.productId },
    ).catch(() => undefined);
    return result;
  }

  @Delete(':productId')
  async remove(
    @CurrentUser('id') userId: number,
    @Req() req: Request,
    @Param('productId') productIdOrSlug: string,
  ) {
    const removedProductId = await this.favoritesService.remove(userId, productIdOrSlug);
    if (removedProductId) {
      void this.analytics?.recordServerEvent(req, userId, CustomerActivityEventType.FAVOURITE_REMOVED, { productId: removedProductId }).catch(() => undefined);
    }
    return { ok: true, productId: productIdOrSlug };
  }
}
