import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { Role } from '@prisma/client';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { AdminAuditLogQueryDto } from './dto/admin-audit-log-query.dto';

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminAuditLogsController {
  constructor(private readonly auditLogs: AdminAuditLogsService) {}

  @Get()
  list(@Query() query: AdminAuditLogQueryDto) {
    return this.auditLogs.list(query);
  }

  @Get('users/:id')
  listForUser(@Param('id', ParseIntPipe) id: number) {
    return this.auditLogs.listForUser(id);
  }
}
