import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProductController } from './product.controller';
import { VariantController } from './variant.controller';
import { ProductService } from './product.service';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { ImagesModule } from '../images/images.module';

@Module({
  imports: [ImagesModule],
  controllers: [ProductController, VariantController],
  providers: [
    ProductService,
    PrismaService,
    RolesGuard,
    SupabaseStorageService,
  ],
  exports: [ProductService, SupabaseStorageService],
})
export class ProductModule {}
