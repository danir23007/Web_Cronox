import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';

@ApiTags('Products')
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'Listar productos con paginación y ordenación' })
  @ApiResponse({ status: 200, description: 'Lista paginada.' })
  getAll(@Query() query: QueryProductsDto) {
    return this.productService.getAllProducts(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Obtener un producto por slug con sus imágenes' })
  @ApiResponse({ status: 200, description: 'Producto encontrado.' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado.' })
  getOne(@Param('slug') slug: string) {
    return this.productService.getBySlug(slug);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.LOGISTICS)
  @ApiOperation({ summary: 'Crear un nuevo producto con imágenes' })
  @ApiResponse({ status: 201, description: 'Producto creado correctamente.' })
  @ApiResponse({ status: 403, description: 'No autorizado.' })
  create(@Body() body: CreateProductDto) {
    return this.productService.createProduct(body);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.LOGISTICS)
  @ApiOperation({ summary: 'Actualizar (PUT) un producto con sus imágenes' })
  @ApiResponse({ status: 200, description: 'Producto actualizado.' })
  @ApiResponse({ status: 403, description: 'No autorizado.' })
  putUpdate(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productService.updateProduct(Number(id), dto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.LOGISTICS)
  @ApiOperation({ summary: 'Actualizar (PATCH) un producto con sus imágenes' })
  @ApiResponse({ status: 200, description: 'Producto actualizado.' })
  @ApiResponse({ status: 403, description: 'No autorizado.' })
  patchUpdate(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productService.updateProduct(Number(id), dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.LOGISTICS)
  @ApiOperation({ summary: 'Eliminar un producto (y sus imágenes)' })
  @ApiResponse({ status: 200, description: 'Producto eliminado.' })
  @ApiResponse({ status: 403, description: 'No autorizado.' })
  remove(@Param('id') id: string) {
    return this.productService.deleteProduct(Number(id));
  }

  @Delete(':id/images/:imageId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.LOGISTICS)
  @ApiOperation({ summary: 'Eliminar una imagen de un producto' })
  @ApiResponse({ status: 200, description: 'Imagen eliminada.' })
  @ApiResponse({ status: 403, description: 'No autorizado.' })
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.productService.deleteImage(Number(id), Number(imageId));
  }
}
