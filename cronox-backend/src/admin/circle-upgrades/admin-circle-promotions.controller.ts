import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminCircleUpgradesService } from './admin-circle-upgrades.service';
import { CircleUpgradeRequestStatus, Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminCircleUpgradeQueryDto } from './dto/admin-circle-upgrade-query.dto';

@Controller('admin/requests/2-3')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.MODERATOR)
export class AdminCirclePromotionsController {
  constructor(private readonly circleUpgradesService: AdminCircleUpgradesService) {}

  @Get()
  list(@Query() query: AdminCircleUpgradeQueryDto) {
    const status = query.status ?? CircleUpgradeRequestStatus.PENDING;
    return this.circleUpgradesService.listAutoRequests(status, query);
  }
}
