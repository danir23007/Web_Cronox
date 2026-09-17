import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseFilters,
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
import { DeleteProductImageDto } from '../../products/dto/update-product.dto';
import { CreateVariantDto } from '../../products/dto/create-variant.dto';
import {
  AdjustStockDto,
  UpdateVariantDto,
} from '../../products/dto/update-variant.dto';
import { AdminProductQueryDto } from './dto/admin-product-query.dto';
import { UpdateProductCategoriesDto } from './dto/update-product-categories.dto';
import { ReorderProductsDto } from './dto/reorder-products.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGE_COUNT,
  SupabaseStorageService,
} from '../../common/storage/supabase-storage.service';
import { ProductImageUploadSizeExceptionFilter } from './product-image-upload-size-exception.filter';

const ALLOWED_PRODUCT_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const PRODUCT_IMAGE_UPLOAD_MULTER_LIMITS = Object.freeze({
  files: MAX_PRODUCT_IMAGE_COUNT,
  fileSize: MAX_PRODUCT_IMAGE_BYTES,
});

@ApiTags('Admin / Products')
@ApiBearerAuth()
@Controller('admin/products')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AdminProductsController {
  constructor(
    private readonly productService: ProductService,
    private readonly storageService: SupabaseStorageService,
  ) {}

  @Get()
  listProducts(@Query() query: AdminProductQueryDto) {
    return this.productService.listAdminProducts(query);
  }

  @Get('order')
  getProductOrder() {
    return this.productService.getProductOrder();
  }

  @Patch('order')
  reorderProducts(
    @Body() dto: ReorderProductsDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.productService.reorderProducts(dto.productIds, adminId);
  }

  @Get(':id')
  getProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productService.getAdminProduct(id);
  }

  @Post()
  createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser('id') adminId?: number,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.productService.createProduct(dto, adminId, idempotencyKey);
  }

  @Post('upload-images')
  @UseFilters(ProductImageUploadSizeExceptionFilter)
  @UseInterceptors(
    FilesInterceptor('files', MAX_PRODUCT_IMAGE_COUNT, {
      limits: PRODUCT_IMAGE_UPLOAD_MULTER_LIMITS,
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

  @Patch(':productId/categories')
  @ApiOperation({ summary: 'Sustituye las categorías asignadas a un producto' })
  @ApiOkResponse({ description: 'Producto con sus categorías actualizadas' })
  @ApiBadRequestResponse({
    description: 'IDs de categoría o producto no válidos',
  })
  @ApiNotFoundResponse({ description: 'Producto no encontrado' })
  updateCategories(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateProductCategoriesDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.productService.replaceProductCategories(
      productId,
      dto.categoryIds,
      adminId,
    );
  }

  @Delete(':id')
  deleteProduct(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.productService.deleteProduct(id, adminId);
  }

  @Delete(':productId/images/:imageId')
  permanentlyDeleteImage(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('imageId', ParseIntPipe) imageId: number,
    @Body() dto: DeleteProductImageDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.productService.permanentlyDeleteArchivedImage(
      productId,
      imageId,
      dto.expectedUpdatedAt,
      adminId,
    );
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
    return this.productService.adjustVariantStock(
      productId,
      variantId,
      dto,
      adminId,
    );
  }
}
