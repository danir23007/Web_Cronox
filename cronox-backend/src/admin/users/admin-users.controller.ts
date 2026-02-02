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
import { AdminUsersService } from './admin-users.service';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  getUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserById(id);
  }

  @Patch(':id/role')
  updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.usersService.updateUserRole(id, dto.role, adminId);
  }

  @Get(':id/audit-logs')
  getUserAuditLogs(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserAuditLogs(id);
  }
}
