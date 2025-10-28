import { Injectable } from '@nestjs/common';
import { Product } from './product.model';

@Injectable()
export class ProductsService {
  findAll(): Product[] {
    return [
      { id: 1, name: 'Camiseta CRONOX 21:23', price: 79 },
      { id: 2, name: 'Sudadera Acid Wash', price: 129 },
    ];
  }
}