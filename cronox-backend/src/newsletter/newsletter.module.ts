import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';
import { NewsletterSettingsService } from './newsletter-settings.service';
import { AdminNewsletterController } from './admin-newsletter.controller';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { WebsiteMediaUploadSizeExceptionFilter } from '../media-framing/media-upload-size-exception.filter';
import { ImagesModule } from '../images/images.module';

@Module({
  imports: [PrismaModule, EmailModule, ImagesModule],
  controllers: [NewsletterController, AdminNewsletterController],
  providers: [
    NewsletterService,
    NewsletterSettingsService,
    SupabaseStorageService,
    WebsiteMediaUploadSizeExceptionFilter,
    AdminGuard,
    RolesGuard,
  ],
  exports: [NewsletterService],
})
export class NewsletterModule {}
