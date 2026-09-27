import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductService } from './product.service';

describe('Product creation categories', () => {
  const fixture = () => {
    const tx = {
      $executeRaw: jest.fn(),
      adminProductCreateRequest: { create: jest.fn(), update: jest.fn() },
      category: { findMany: jest.fn().mockResolvedValue([{ id: 2 }, { id: 7 }]) },
      product: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 99 }),
        findUnique: jest.fn().mockResolvedValue({ id: 99, price: 2500, variants: [], images: [], categories: [] }) },
      productVariant: { createMany: jest.fn() }, auditLog: { create: jest.fn() },
    };
    const db = { $transaction: jest.fn(fn => fn(tx)) };
    return { tx, service: new ProductService(db as any) };
  };
  const key = 'category-create-test-000001';
  it('creates unique associations inside the transaction and canonicalizes the idempotency hash', async () => {
    const { service, tx } = fixture();
    await service.createProduct({ name: 'Prueba', price: 2500, categoryIds: [7, 2, 7] }, 1, key);
    expect(tx.product.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      categories: { create: [{ categoryId: 2 }, { categoryId: 7 }] },
    }) }));
    const firstHash = tx.adminProductCreateRequest.create.mock.calls[0][0].data.requestHash;
    await service.createProduct({ name: 'Prueba', price: 2500, categoryIds: [2, 7] }, 1, key);
    expect(tx.adminProductCreateRequest.create.mock.calls[1][0].data.requestHash).toBe(firstHash);
    expect(tx.category.findMany).toHaveBeenCalledWith({ where: { id: { in: [2, 7] } }, select: { id: true } });
  });
  it('rejects missing categories before creating any product', async () => {
    const { service, tx } = fixture();
    await expect(service.createProduct({ name: 'Prueba', price: 2500, categoryIds: [404] }, 1, key)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.product.create).not.toHaveBeenCalled();
    expect(tx.productVariant.createMany).not.toHaveBeenCalled();
  });
  it.each([undefined, []])('keeps category-free creation compatible (%s)', async categoryIds => {
    const { service, tx } = fixture();
    await service.createProduct({ name: 'Prueba', price: 2500, categoryIds }, 1, key);
    expect(tx.category.findMany).not.toHaveBeenCalled();
    expect(tx.product.create.mock.calls[0][0].data.categories).toBeUndefined();
  });
  it.each([[-1], [0], [1.5], ['2'], '2'])('validates category ID shape: %s', async categoryIds => {
    const dto = Object.assign(new CreateProductDto(), { name: 'Prueba', price: 2500, categoryIds });
    expect((await validate(dto)).some(error => error.property === 'categoryIds')).toBe(true);
  });
});
