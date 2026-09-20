import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UpdateFooterSettingsDto } from './dto/update-footer-settings.dto';
import { FooterSettingsService } from './footer-settings.service';

@Controller('admin/footer')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminFooterController {
  constructor(private readonly settings: FooterSettingsService) {}

  @Get()
  getSettings() {
    return this.settings.getAdminSettings();
  }

  @Patch()
  update(
    @Body() dto: UpdateFooterSettingsDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.settings.update(dto, adminId);
  }
}
