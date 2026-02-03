import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminNotesService } from './admin-notes.service';
import { AdminNoteQueryDto } from './dto/admin-note-query.dto';
import { CreateAdminNoteDto } from './dto/create-admin-note.dto';
import { UpdateAdminNoteDto } from './dto/update-admin-note.dto';
import { Role } from '@prisma/client';

@Controller('admin/notes')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.MODERATOR)
export class AdminNotesController {
  constructor(private readonly notes: AdminNotesService) {}

  @Get()
  list(@Query() query: AdminNoteQueryDto) {
    return this.notes.list(query);
  }

  @Post()
  create(
    @Body() dto: CreateAdminNoteDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.notes.create(adminId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminNoteDto,
    @CurrentUser('id') adminId: number,
    @CurrentUser('role') role: Role | null,
  ) {
    return this.notes.update(id, adminId, role, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser('id') adminId: number,
    @CurrentUser('role') role: Role | null,
  ) {
    return this.notes.remove(id, adminId, role);
  }
}
