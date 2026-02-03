import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { Role } from '@prisma/client';
import {
  AdminCreatePromoCodeDto,
  AdminPromoCodeQueryDto,
  AdminUpdatePromoCodeDto,
} from './dto/admin-promo-code.dto';
import { AdminPromoCodesService } from './admin-promo-codes.service';

@Controller('admin/promo-codes')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.MARKETING)
export class AdminPromoCodesController {
  constructor(private readonly promoCodes: AdminPromoCodesService) {}

  @Get()
  list(@Query() query: AdminPromoCodeQueryDto) {
    return this.promoCodes.list(query);
  }

  @Post()
  create(@Body() dto: AdminCreatePromoCodeDto, @CurrentUser('id') adminId?: number) {
    return this.promoCodes.create(dto, adminId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUpdatePromoCodeDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.promoCodes.update(id, dto, adminId);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') adminId?: number) {
    return this.promoCodes.softDelete(id, adminId);
  }
}
