import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { QueryCategoriesDto } from './dto/query-categories.dto';
import { ProductService } from '../products/product.service';
import { QueryProductsDto } from '../products/dto/query-products.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly productService: ProductService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista las categorías activas' })
  @ApiOkResponse({ description: 'Listado paginado de categorías activas' })
  list(@Query() query: QueryCategoriesDto) {
    return this.categoriesService.listActive(query);
  }

  @Get(':slug/products')
  @ApiOperation({ summary: 'Productos pertenecientes a una categoría por slug' })
  @ApiOkResponse({ description: 'Listado de productos para la categoría' })
  async listProducts(
    @Param('slug') slug: string,
    @Query() query: QueryProductsDto,
  ) {
    const category = await this.categoriesService.getActiveBySlugOrThrow(slug);
    const products = await this.productService.getAllProducts({
      ...query,
      categorySlug: category.slug,
    });

    return {
      category,
      products,
    };
  }
}
