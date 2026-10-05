import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { ProductController } from './product.controller';
import { VariantController } from './variant.controller';
import { ProductService } from './product.service';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { ImagesModule } from '../images/images.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ImagesModule, PrismaModule],
  controllers: [ProductController, VariantController],
  providers: [
    ProductService,
    RolesGuard,
    SupabaseStorageService,
  ],
  exports: [ProductService, SupabaseStorageService],
})
export class ProductModule {}
