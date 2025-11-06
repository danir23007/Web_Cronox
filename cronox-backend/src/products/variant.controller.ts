import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProductService } from './product.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { AdjustStockDto, UpdateVariantDto } from './dto/update-variant.dto';

@ApiTags('Product Variants')
@ApiBearerAuth()
@Controller('products/:productId/variants')
export class VariantController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Crear variantes para un producto' })
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateVariantDto | CreateVariantDto[],
  ) {
    return this.productService.createVariants(Number(productId), dto);
  }

  @Patch(':variantId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Actualizar una variante' })
  update(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productService.updateVariant(
      Number(productId),
      Number(variantId),
      dto,
    );
  }

  @Patch(':variantId/adjust-stock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Ajustar stock de una variante (delta +/-)' })
  adjustStock(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.productService.adjustVariantStock(
      Number(productId),
      Number(variantId),
      dto,
      userId,
    );
  }

  @Delete(':variantId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Eliminar una variante' })
  remove(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.productService.deleteVariant(
      Number(productId),
      Number(variantId),
    );
  }
}
