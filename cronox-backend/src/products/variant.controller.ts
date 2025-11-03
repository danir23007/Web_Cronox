import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ProductService } from './product.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { AdjustStockDto, UpdateVariantDto } from './dto/update-variant.dto';

@ApiTags('Product Variants')
@ApiBearerAuth()
@Controller('products/:productId/variants')
export class VariantController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Crear variantes para un producto' })
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateVariantDto | CreateVariantDto[],
  ) {
    return this.productService.createVariants(Number(productId), dto);
  }

  @Patch(':variantId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.admin)
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
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Ajustar stock de una variante (delta +/-)' })
  adjustStock(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.productService.adjustVariantStock(
      Number(productId),
      Number(variantId),
      dto,
    );
  }

  @Delete(':variantId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.admin)
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
