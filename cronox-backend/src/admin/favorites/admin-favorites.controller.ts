import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminFavoritesService } from './admin-favorites.service';

export class FavoritesQuery {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['desc', 'asc']) sort: 'desc' | 'asc' = 'desc';
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

// Same guards and declared roles as management of products.
@Controller('admin/favorites')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AdminFavoritesController {
  constructor(private readonly service: AdminFavoritesService) {}
  @Get() report(@Query() query: FavoritesQuery) {
    return this.service.report(query);
  }
}
