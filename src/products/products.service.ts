import { Injectable } from '@nestjs/common';

interface Product {
  id: number;
  name: string;
  price: number;
}

@Injectable()
export class ProductsService {
  private readonly products: Product[] = [
    { id: 1, name: 'Camiseta CRONOX 21:23', price: 79 },
    { id: 2, name: 'Sudadera Acid Wash', price: 129 },
  ];

  findAll(): Product[] {
    return this.products;
  }
}
