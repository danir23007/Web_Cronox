import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards, Query, DefaultValuePipe } from '@nestjs/common';
import { TrackingBulkSyncDto } from '../admin/orders/dto/tracking-bulk.dto';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserIdentityGuard } from '../users/user-identity.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { TrackingService } from './tracking.service';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard, UserIdentityGuard, SuperAdminGuard)
@Roles(Role.SUPERADMIN)
export class TrackingAdminController {
  constructor(private readonly tracking: TrackingService) {}
  @Get('tracking-bulk/review')
  review(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) { return this.tracking.reviewExisting(page); }
  @Post('tracking-bulk/sync')
  bulkSync(@Body() dto: TrackingBulkSyncDto) { return this.tracking.syncBulk(dto.orderIds); }
  @Get(':id/tracking')
  get(@Param('id', ParseIntPipe) id: number) { return this.tracking.getOrderTracking(id); }
  @Post(':id/tracking/sync')
  sync(@Param('id', ParseIntPipe) id: number) { return this.tracking.syncOrder(id); }
}
