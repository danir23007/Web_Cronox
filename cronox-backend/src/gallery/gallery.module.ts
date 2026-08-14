import { Module } from '@nestjs/common';
import { ProductModule } from '../products/product.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminGalleryController } from './admin-gallery.controller';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { GalleryUploadSizeExceptionFilter } from './gallery-upload-size-exception.filter';

@Module({
  imports: [ProductModule],
  controllers: [GalleryController, AdminGalleryController],
  providers: [
    GalleryService,
    GalleryUploadSizeExceptionFilter,
    AdminGuard,
    RolesGuard,
  ],
  exports: [GalleryService],
})
export class GalleryModule {}
