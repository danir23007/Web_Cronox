import { Controller, Get } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product, ProductImage } from '@prisma/client';

type ProductWithImages = Product & {
  images: Array<Pick<ProductImage, 'url' | 'alt' | 'sortOrder' | 'isPrimary'>>;
};

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getAll(): Promise<ProductWithImages[]> {
    return this.productsService.findAll();
  }
}
