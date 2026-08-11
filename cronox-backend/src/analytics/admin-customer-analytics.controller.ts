import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AdminCustomerAnalyticsService } from './admin-customer-analytics.service';
import { AdminActivityQueryDto } from './dto/admin-activity-query.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.MODERATOR)
export class AdminCustomerAnalyticsController {
  constructor(private readonly analytics: AdminCustomerAnalyticsService) {}

  @Get(':id/analytics/summary')
  summary(@Param('id', ParseIntPipe) id: number) {
    return this.analytics.summary(id);
  }

  @Get(':id/analytics/products')
  products(@Param('id', ParseIntPipe) id: number) {
    return this.analytics.products(id);
  }

  @Get(':id/analytics/timeline')
  timeline(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminActivityQueryDto,
  ) {
    return this.analytics.timeline(id, query);
  }

  @Get(':id/login-history')
  logins(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminActivityQueryDto,
  ) {
    return this.analytics.logins(id, query);
  }
}
