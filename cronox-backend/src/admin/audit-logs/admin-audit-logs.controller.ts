import { Body, Controller, Delete, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { Roles } from '../../common/roles.decorator';
import { Role } from '@prisma/client';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { AdminAuditLogQueryDto } from './dto/admin-audit-log-query.dto';

export class ClearActivityDto {
  @IsIn(['DELETE_ALL_ACTIVITY'])
  confirmation: string;
}

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AdminAuditLogsController {
  constructor(private readonly auditLogs: AdminAuditLogsService) {}

  @Get()
  list(@Query() query: AdminAuditLogQueryDto) {
    return this.auditLogs.list(query);
  }

  @Delete()
  @UseGuards(SuperAdminGuard)
  @Roles(Role.SUPERADMIN)
  clear(@Body() body: ClearActivityDto) {
    return this.auditLogs.clear(body.confirmation);
  }

  @Get('users/:id')
  listForUser(@Param('id', ParseIntPipe) id: number) {
    return this.auditLogs.listForUser(id);
  }
}
