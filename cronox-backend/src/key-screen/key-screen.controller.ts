import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Express } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { MAX_WEBSITE_MEDIA_BYTES } from '../common/storage/supabase-storage.service';
import {
  CreateKeyScreenDto,
  PreRegisterDto,
  SelectKeyScreenDto,
  SetKeyScreenEnabledDto,
  UpdateKeyScreenDto,
} from './dto/key-screen.dto';
import { KeyScreenService } from './key-screen.service';

@Controller('key-screen')
export class PublicKeyScreenController {
  constructor(private readonly keyScreen: KeyScreenService) {}

  @Get()
  @Header('Cache-Control', 'no-store, max-age=0')
  state() {
    return this.keyScreen.publicState();
  }

  @Post('preregister')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  preregister(@Body() dto: PreRegisterDto) {
    return this.keyScreen.preregister(dto.email);
  }
}

@Controller('admin/key-screens')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.SUPERADMIN)
export class AdminKeyScreenController {
  constructor(private readonly keyScreen: KeyScreenService) {}

  @Get() state() {
    return this.keyScreen.adminState();
  }
  @Post() create(
    @Body() dto: CreateKeyScreenDto,
    @CurrentUser('id') id?: number,
  ) {
    return this.keyScreen.create(dto, id);
  }
  @Patch('master') setEnabled(
    @Body() dto: SetKeyScreenEnabledDto,
    @CurrentUser('id') id?: number,
  ) {
    return this.keyScreen.setEnabled(dto.enabled, id);
  }
  @Patch('active') activate(
    @Body() dto: SelectKeyScreenDto,
    @CurrentUser('id') id?: number,
  ) {
    return this.keyScreen.activate(dto.screenId, id);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() dto: UpdateKeyScreenDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.keyScreen.update(id, dto, adminId);
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.keyScreen.remove(id);
  }
  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: MAX_WEBSITE_MEDIA_BYTES },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') id?: number,
  ) {
    return this.keyScreen.upload(file, id);
  }
}
