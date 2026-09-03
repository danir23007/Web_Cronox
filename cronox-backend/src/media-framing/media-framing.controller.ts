import {
  Body,
  Controller,
  Get,
  Header,
  Param,
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
import {
  ResetMediaFramingDto,
  SelectWebsiteMediaAssetDto,
  UpdateMediaFramingDto,
} from './dto/media-frame.dto';
import { MediaFramingService } from './media-framing.service';
import { MAX_WEBSITE_MEDIA_BYTES } from '../common/storage/supabase-storage.service';
import { WebsiteMediaUploadSizeExceptionFilter } from './media-upload-size-exception.filter';

export const MEDIA_ADMIN_ROLES = [
  Role.SUPER_ADMIN,
  Role.MODERATOR,
  Role.LOGISTICS,
  Role.MARKETING,
  Role.ADMIN,
  Role.SUPERADMIN,
];

export const WEBSITE_MEDIA_UPLOAD_MULTER_LIMITS = Object.freeze({
  files: 1,
  fileSize: MAX_WEBSITE_MEDIA_BYTES,
});

@Controller('media-framing')
export class MediaFramingController {
  constructor(private readonly mediaFraming: MediaFramingService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=0, must-revalidate')
  getPublicFraming() {
    return this.mediaFraming.getPublicFraming();
  }
}

@Controller('admin/media')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(...MEDIA_ADMIN_ROLES)
export class AdminMediaFramingController {
  constructor(private readonly mediaFraming: MediaFramingService) {}

  @Get('placements')
  getPlacements() {
    return this.mediaFraming.getAdminPlacements();
  }

  @Get('placements/:key')
  getPlacement(@Param('key') key: string) {
    return this.mediaFraming.getAdminPlacement(key);
  }

  @Get('library')
  getLibrary() {
    return this.mediaFraming.getAssetLibrary();
  }

  @Post('placements/:key/assets')
  @UseFilters(WebsiteMediaUploadSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: WEBSITE_MEDIA_UPLOAD_MULTER_LIMITS,
    }),
  )
  uploadAsset(
    @Param('key') key: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.mediaFraming.uploadAsset(key, file, adminId);
  }

  @Patch('placements/:key/asset')
  selectAsset(
    @Param('key') key: string,
    @Body() dto: SelectWebsiteMediaAssetDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.mediaFraming.selectAsset(key, dto, adminId);
  }

  @Patch('placements/:key')
  updatePlacement(
    @Param('key') key: string,
    @Body() dto: UpdateMediaFramingDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.mediaFraming.updatePlacement(key, dto, adminId);
  }

  @Post('placements/:key/reset')
  resetPlacement(
    @Param('key') key: string,
    @Body() dto: ResetMediaFramingDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.mediaFraming.resetPlacement(key, dto, adminId);
  }
}
