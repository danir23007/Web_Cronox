import { Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { LaunchCampaignService } from './launch-campaign.service';

@Controller('admin/launch')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class LaunchCampaignController {
  constructor(private readonly launch: LaunchCampaignService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  preview() { return this.launch.preview(); }
  @Post('send')
  send() { return this.launch.sendBatch(); }
}
