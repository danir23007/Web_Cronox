import {
  Body,
  Controller,
  Get,
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
import { MAX_GALLERY_IMAGE_BYTES } from '../common/storage/supabase-storage.service';
import { UpdateGallerySlotDto } from './dto/update-gallery-slot.dto';
import { GalleryService } from './gallery.service';
import { GalleryUploadSizeExceptionFilter } from './gallery-upload-size-exception.filter';

const GALLERY_ADMIN_ROLES = [
  Role.SUPER_ADMIN,
  Role.MODERATOR,
  Role.LOGISTICS,
  Role.MARKETING,
  Role.ADMIN,
  Role.SUPERADMIN,
];
const ALLOWED_GALLERY_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const GALLERY_UPLOAD_MULTER_LIMITS = Object.freeze({
  files: 1,
  fileSize: MAX_GALLERY_IMAGE_BYTES,
});

@Controller('admin/gallery')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(...GALLERY_ADMIN_ROLES)
export class AdminGalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get('slots')
  getSlots() {
    return this.galleryService.getAdminSlots();
  }

  @Get('assets')
  getAssets() {
    return this.galleryService.getAssetLibrary();
  }

  @Post('assets')
  @UseFilters(GalleryUploadSizeExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: GALLERY_UPLOAD_MULTER_LIMITS,
      fileFilter: (_request, file, callback) => {
        callback(null, ALLOWED_GALLERY_MIME_TYPES.has(file.mimetype));
      },
    }),
  )
  uploadAsset(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.galleryService.uploadAsset(file, adminId);
  }

  @Patch('slots/:key')
  updateSlot(
    @Param('key') key: string,
    @Body() dto: UpdateGallerySlotDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.galleryService.updateSlot(key, dto, adminId);
  }
}
