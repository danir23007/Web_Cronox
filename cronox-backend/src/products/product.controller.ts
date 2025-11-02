import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';

@ApiTags('Products')
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener todos los productos con sus imágenes' })
  @ApiResponse({ status: 200, description: 'Lista de productos devuelta correctamente.' })
  getAll() {
    return this.productService.getAllProducts();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Obtener un producto por slug con sus imágenes' })
  @ApiResponse({ status: 200, description: 'Producto encontrado.' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado.' })
  getOne(@Param('slug') slug: string) {
    return this.productService.getBySlug(slug);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo producto con imágenes' })
  @ApiResponse({ status: 201, description: 'Producto creado correctamente.' })
  create(@Body() body: CreateProductDto) {
    return this.productService.createProduct(body);
  }
}
