import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { ProductService } from '../../products/product.service';
import type { Express } from 'express';
import { Role } from '@prisma/client';
import { CreateProductDto } from '../../products/dto/create-product.dto';
import { UpdateProductDto } from '../../products/dto/update-product.dto';
import { CreateVariantDto } from '../../products/dto/create-variant.dto';
import { AdjustStockDto, UpdateVariantDto } from '../../products/dto/update-variant.dto';
import { AdminProductQueryDto } from './dto/admin-product-query.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGE_COUNT,
  SupabaseStorageService,
} from '../../common/storage/supabase-storage.service';

const ALLOWED_PRODUCT_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Controller('admin/products')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.LOGISTICS)
export class AdminProductsController {
  constructor(
    private readonly productService: ProductService,
    private readonly storageService: SupabaseStorageService,
  ) {}

  @Get()
  listProducts(@Query() query: AdminProductQueryDto) {
    return this.productService.listAdminProducts(query);
  }

  @Get(':id')
  getProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productService.getAdminProduct(id);
  }

  @Post()
  createProduct(@Body() dto: CreateProductDto, @CurrentUser('id') adminId?: number) {
    return this.productService.createProduct(dto, adminId);
  }

  @Post('upload-images')
  @UseInterceptors(
    FilesInterceptor('files', MAX_PRODUCT_IMAGE_COUNT, {
      limits: {
        files: MAX_PRODUCT_IMAGE_COUNT,
        fileSize: MAX_PRODUCT_IMAGE_BYTES,
      },
      fileFilter: (_request, file, callback) => {
        callback(null, ALLOWED_PRODUCT_IMAGE_MIME_TYPES.has(file.mimetype));
      },
    }),
  )
  async uploadImages(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser('id') adminId?: number,
  ) {
    return this.storageService.uploadProductImages(files, adminId);
  }

  @Patch(':id')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.productService.updateProduct(id, dto, adminId);
  }

  @Delete(':id')
  deleteProduct(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') adminId?: number) {
    return this.productService.deleteProduct(id, adminId);
  }

  @Post(':productId/variants')
  createVariant(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreateVariantDto | CreateVariantDto[],
  ) {
    return this.productService.createVariants(productId, dto);
  }

  @Patch(':productId/variants/:variantId')
  updateVariant(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productService.updateVariant(productId, variantId, dto);
  }

  @Delete(':productId/variants/:variantId')
  deleteVariant(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('variantId', ParseIntPipe) variantId: number,
  ) {
    return this.productService.deleteVariant(productId, variantId);
  }

  @Patch(':productId/variants/:variantId/adjust-stock')
  adjustStock(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: AdjustStockDto,
    @CurrentUser('id') adminId: number,
  ) {
    return this.productService.adjustVariantStock(productId, variantId, dto, adminId);
  }
}
