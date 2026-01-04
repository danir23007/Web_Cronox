import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CircleUpgradeRequestStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminCircleUpgradesService } from './admin-circle-upgrades.service';
import { AdminCircleUpgradeQueryDto } from './dto/admin-circle-upgrade-query.dto';
import { AdminCircleUpgradeReviewDto } from './dto/admin-circle-upgrade-review.dto';

@Controller('admin/circle-upgrades/3-4')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCircleUpgradesController {
  constructor(private readonly adminCircleUpgradesService: AdminCircleUpgradesService) {}

  @Get()
  list(@Query() query: AdminCircleUpgradeQueryDto) {
    const status = query.status ?? CircleUpgradeRequestStatus.PENDING;
    return this.adminCircleUpgradesService.list(status);
  }

  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() review: AdminCircleUpgradeReviewDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.adminCircleUpgradesService.approve(id, review, adminId);
  }

  @Patch(':id/deny')
  deny(
    @Param('id') id: string,
    @Body() review: AdminCircleUpgradeReviewDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.adminCircleUpgradesService.deny(id, review, adminId);
  }
}
