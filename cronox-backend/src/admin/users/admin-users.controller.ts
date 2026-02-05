import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
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

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.MODERATOR)
  getUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserById(id);
  }

  @Patch(':id/role')
  @Roles(Role.SUPER_ADMIN)
  updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.usersService.updateUserRole(id, dto.role, adminId);
  }

  @Get(':id/audit-logs')
  @Roles(Role.SUPER_ADMIN, Role.MODERATOR)
  getUserAuditLogs(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserAuditLogs(id);
  }

  @Get(':id/requests')
  @Roles(Role.SUPER_ADMIN, Role.MODERATOR)
  getUserRequests(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminUserRequestsQueryDto,
  ) {
    return this.usersService.getUserRequests(id, query);
  }

  @Get(':id/orders')
  @Roles(Role.SUPER_ADMIN, Role.MODERATOR)
  getUserOrders(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminUserOrdersQueryDto,
  ) {
    return this.usersService.getUserOrders(id, query);
  }
}
