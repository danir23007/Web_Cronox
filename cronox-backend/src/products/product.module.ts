import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProductController } from './product.controller';
import { VariantController } from './variant.controller';
import { ProductService } from './product.service';

@Module({
  controllers: [ProductController, VariantController],
  providers: [ProductService, PrismaService, RolesGuard],
  exports: [ProductService],
})
export class ProductModule {}
