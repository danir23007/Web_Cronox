import { ProductService } from './product.service';
import { FavoritesService } from '../favorites/favorites.service';

describe('historical product API resolution', () => {
  it('accepts a historical slug from a cached favorites client without duplicating the product', async () => {
    const product = { id: 4, slug: 'armored-coal', price: 6500, images: [], variants: [] };
    const tx = { $executeRaw: jest.fn(), favorite: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product), findUnique: jest.fn().mockResolvedValue({ id: 4 }) },
      $transaction: jest.fn(callback => callback(tx)),
    };
    const service = new FavoritesService(prisma as never);
    expect(await service.add(1, { slug: 'shielded-coal' })).toMatchObject({ productId: 4, product: { slug: 'armored-coal' } });
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'armored-coal', isActive: true } }));
    expect(await service.remove(1, 'shielded-coal')).toBe(4);
    expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { slug: 'armored-coal' }, select: { id: true } });
  });
  it('resolves the old slug to the same active product ID and returns the new slug', async () => {
    const product = { id: 4, slug: 'armored-coal', name: 'ARMORED COAL', price: 6500, variants: [], images: [] };
    const findUnique = jest.fn().mockResolvedValue(product);
    const service = new ProductService({ product: { findUnique } } as never);
    expect(await service.getBySlug('shielded-coal')).toMatchObject(product);
    expect(findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 4, slug: 'armored-coal', isActive: true } }));
    await service.getBySlug('armored-coal');
    expect(findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { slug: 'armored-coal', isActive: true } }));
    findUnique.mockResolvedValue(null);
    expect(await service.getBySlug('shielded-coal')).toBeNull();
  });
});
