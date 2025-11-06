import {
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductService } from '../../products/product.service';
import { CreateProductDto } from '../../products/dto/create-product.dto';
import { UpdateProductDto } from '../../products/dto/update-product.dto';
import { CreateVariantDto } from '../../products/dto/create-variant.dto';
import { AdjustStockDto, UpdateVariantDto } from '../../products/dto/update-variant.dto';

@Controller('admin/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminProductsController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  createProduct(@Body() dto: CreateProductDto) {
    return this.productService.createProduct(dto);
  }

  @Patch(':id')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.updateProduct(id, dto);
  }

  @Delete(':id')
  deleteProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productService.deleteProduct(id);
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
