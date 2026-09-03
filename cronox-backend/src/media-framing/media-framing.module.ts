import { Module } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import {
  AdminMediaFramingController,
  MediaFramingController,
} from './media-framing.controller';
import { MediaFramingService } from './media-framing.service';
import { WebsiteMediaUploadSizeExceptionFilter } from './media-upload-size-exception.filter';

@Module({
  controllers: [MediaFramingController, AdminMediaFramingController],
  providers: [
    MediaFramingService,
    SupabaseStorageService,
    WebsiteMediaUploadSizeExceptionFilter,
    AdminGuard,
    RolesGuard,
  ],
})
export class MediaFramingModule {}
