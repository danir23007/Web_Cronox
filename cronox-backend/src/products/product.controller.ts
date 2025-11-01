import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  getAll() {
    return this.productService.getAllProducts();
  }

  @Get(':slug')
  getOne(@Param('slug') slug: string) {
    return this.productService.getBySlug(slug);
  }

  @Post()
  create(@Body() body: CreateProductDto) {
    return this.productService.createProduct(body);
  }
}
