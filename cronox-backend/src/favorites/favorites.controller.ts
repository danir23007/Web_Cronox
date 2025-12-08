import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async list(@CurrentUser('id') userId: number) {
    return this.favoritesService.list(userId);
  }

  @Get('products')
  async listProducts(@CurrentUser('id') userId: number) {
    return this.favoritesService.listProducts(userId);
  }

  @Post()
  async add(@CurrentUser('id') userId: number, @Body() dto: AddFavoriteDto) {
    return this.favoritesService.add(userId, dto);
  }

  @Post('toggle')
  async toggle(@CurrentUser('id') userId: number, @Body() dto: AddFavoriteDto) {
    return this.favoritesService.toggle(userId, dto);
  }

  @Delete(':productId')
  async remove(
    @CurrentUser('id') userId: number,
    @Param('productId') productIdOrSlug: string,
  ) {
    await this.favoritesService.remove(userId, productIdOrSlug);
    return { ok: true, productId: productIdOrSlug };
  }
}
