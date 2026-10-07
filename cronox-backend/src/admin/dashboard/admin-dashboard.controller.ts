import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get('pending-counts')
  getPendingCounts() {
    return this.dashboardService.getPendingCounts();
  }

  @Get()
  getOverview() {
    return this.dashboardService.getOverview();
  }
}
