import { UserIdentityGuard } from '../../users/user-identity.guard';
import { Body, Controller, Get, Headers, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminManualPurchasesService } from './admin-manual-purchases.service';
import { EditManualPurchaseDto } from './dto/edit-manual-purchase.dto';
import { CreateManualPurchaseDto } from './dto/create-manual-purchase.dto';
import { ManualStatisticsDto } from './dto/manual-statistics.dto';
import { VoidManualPurchaseDto } from './dto/void-manual-purchase.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard, SuperAdminGuard, UserIdentityGuard)
@Roles(Role.SUPERADMIN)
export class AdminManualPurchasesController {
  constructor(private readonly service: AdminManualPurchasesService) {}

  @Get(':id/in-person-purchase-options')
  getOptions(@Param('id', ParseIntPipe) id: number) {
    return this.service.getOptions(id);
  }

  @Get(':id/in-person-purchases/:orderId')
  getForEdit(@Param('id', ParseIntPipe) userId: number, @Param('orderId', ParseIntPipe) orderId: number) {
    return this.service.getForEdit(userId, orderId);
  }

  @Patch(':id/in-person-purchases/:orderId')
  edit(
    @Param('id', ParseIntPipe) userId: number,
    @Param('orderId', ParseIntPipe) orderId: number,
    @CurrentUser('id') adminId: number,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: EditManualPurchaseDto,
  ) { return this.service.edit(userId, orderId, adminId, key, dto); }

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
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard, SuperAdminGuard, UserIdentityGuard)
@Roles(Role.SUPERADMIN)
export class AdminManualPurchaseCorrectionsController {
  constructor(private readonly service: AdminManualPurchasesService) {}

  @Post(':id/statistics-exclusion')
  statistics(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') adminId: number,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: ManualStatisticsDto,
  ) {
    return this.service.setStatisticsExclusion(id, adminId, key, dto.excludedFromStatistics);
  }

  @Post(':id/void-manual')
  void(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') adminId: number,
    @Body() dto: VoidManualPurchaseDto,
  ) {
    return this.service.void(id, adminId, dto.reason);
  }
}
