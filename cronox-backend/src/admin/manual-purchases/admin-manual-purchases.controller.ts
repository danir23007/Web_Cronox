import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminManualPurchasesService } from './admin-manual-purchases.service';
import { CreateManualPurchaseDto } from './dto/create-manual-purchase.dto';
import { VoidManualPurchaseDto } from './dto/void-manual-purchase.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard, SuperAdminGuard)
@Roles(Role.SUPERADMIN)
export class AdminManualPurchasesController {
  constructor(private readonly service: AdminManualPurchasesService) {}

  @Get(':id/in-person-purchase-options')
  getOptions(@Param('id', ParseIntPipe) id: number) {
    return this.service.getOptions(id);
  }

  @Post(':id/in-person-purchases')
  create(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') adminId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateManualPurchaseDto,
  ) {
    return this.service.create(id, adminId, idempotencyKey, dto);
  }
}

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard, SuperAdminGuard)
@Roles(Role.SUPERADMIN)
export class AdminManualPurchaseCorrectionsController {
  constructor(private readonly service: AdminManualPurchasesService) {}

  @Post(':id/void-manual')
  void(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') adminId: number,
    @Body() dto: VoidManualPurchaseDto,
  ) {
    return this.service.void(id, adminId, dto.reason);
  }
}
