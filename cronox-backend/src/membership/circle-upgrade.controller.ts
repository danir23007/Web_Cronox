import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { CircleUpgradeService } from './circle-upgrade.service';
import { CreateCircleUpgradeDto, UpdateCircleUpgradeStatusDto } from './dto/circle-upgrade.dto';

@Controller('upgrade/3-4')
@UseGuards(JwtAuthGuard)
export class CircleUpgradeController {
  constructor(private readonly circleUpgradeService: CircleUpgradeService) {}

  @Get('status')
  getStatus(@CurrentUser('id') userId: number) {
    return this.circleUpgradeService.getStatus(userId);
  }

  @Post()
  createRequest(@CurrentUser('id') userId: number, @Body() dto: CreateCircleUpgradeDto) {
    return this.circleUpgradeService.createRequest(userId, dto);
  }
}

@Controller('admin/upgrade/3-4')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCircleUpgradeController {
  constructor(private readonly circleUpgradeService: CircleUpgradeService) {}

  @Patch(':id')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCircleUpgradeStatusDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.circleUpgradeService.updateStatus(id, dto, adminId);
  }
}
