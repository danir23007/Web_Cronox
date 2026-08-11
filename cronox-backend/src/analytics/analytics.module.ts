import { Module } from '@nestjs/common';
import { AccessAuthModule } from '../auth/access-auth.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminCustomerAnalyticsController } from './admin-customer-analytics.controller';
import { AdminCustomerAnalyticsService } from './admin-customer-analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsMaintenanceService } from './analytics-maintenance.service';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [PrismaModule, AccessAuthModule],
  controllers: [AnalyticsController, AdminCustomerAnalyticsController],
  providers: [AnalyticsService, AdminCustomerAnalyticsService, AnalyticsMaintenanceService, AdminGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
