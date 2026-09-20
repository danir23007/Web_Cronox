import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Express } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { MAX_WEBSITE_MEDIA_BYTES } from '../common/storage/supabase-storage.service';
import { WebsiteMediaUploadSizeExceptionFilter } from '../media-framing/media-upload-size-exception.filter';
import { UpdateNewsletterSettingsDto } from './dto/newsletter-settings.dto';
import { NewsletterSettingsService } from './newsletter-settings.service';

@Controller('admin/newsletter')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminNewsletterController {
  constructor(private readonly settings: NewsletterSettingsService) {}

  @Get()
  getSettings() {
    return this.settings.getAdminSettings();
  }

  @Get('assets')
  getAssets() {
    return this.settings.listImageAssets();
  }

  @Post('assets')
  @UseFilters(WebsiteMediaUploadSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: MAX_WEBSITE_MEDIA_BYTES },
    }),
  )
  uploadAsset(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.settings.uploadImage(file, adminId);
  }

  @Patch()
  updateSettings(
    @Body() dto: UpdateNewsletterSettingsDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.settings.update(dto, adminId);
  }
}
