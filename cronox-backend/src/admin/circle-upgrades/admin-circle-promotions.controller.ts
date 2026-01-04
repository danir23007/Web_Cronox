import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminCircleUpgradesService } from './admin-circle-upgrades.service';
import { CircleUpgradeRequestStatus } from '@prisma/client';

@Controller('admin/requests/2-3')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCirclePromotionsController {
  constructor(private readonly circleUpgradesService: AdminCircleUpgradesService) {}

  @Get()
  list(@Query('status') status?: CircleUpgradeRequestStatus) {
    return this.circleUpgradesService.listAutoRequests(status);
  }
}
