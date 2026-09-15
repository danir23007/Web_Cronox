import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminUsersService } from './admin-users.service';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AdminUserOrdersQueryDto } from './dto/admin-user-orders-query.dto';
import { AdminUserRequestsQueryDto } from './dto/admin-user-requests-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { Role } from '@prisma/client';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.usersService.listUsers(query);
  }

  @Get('edit-options')
  @UseGuards(SuperAdminGuard)
  getEditOptions() {
    return this.usersService.getEditOptions();
  }

  @Get(':id')
  @Roles(Role.SUPERADMIN)
  getUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserById(id);
  }

  @Patch(':id/role')
  @Roles(Role.SUPERADMIN)
  @UseGuards(SuperAdminGuard)
  updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.usersService.updateUserRole(
      id,
      dto.role,
      adminId,
      dto.expectedUpdatedAt,
    );
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminUserDto,
    @CurrentUser('id') adminId: number,
    @Req() request: Request,
  ) {
    const requestId = request.headers['x-request-id'];
    return this.usersService.updateAdminUser(id, dto, adminId, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
      requestId: Array.isArray(requestId) ? requestId[0] : requestId,
    });
  }

  @Get(':id/audit-logs')
  @Roles(Role.SUPERADMIN)
  getUserAuditLogs(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserAuditLogs(id);
  }

  @Get(':id/requests')
  @Roles(Role.SUPERADMIN)
  getUserRequests(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminUserRequestsQueryDto,
  ) {
    return this.usersService.getUserRequests(id, query);
  }

  @Get(':id/orders')
  @Roles(Role.SUPERADMIN)
  getUserOrders(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminUserOrdersQueryDto,
  ) {
    return this.usersService.getUserOrders(id, query);
  }
}
