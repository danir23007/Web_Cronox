/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ProductService } from './product.service';

describe('ProductService search', () => {
  it('requests bounded active suggestions and returns only presentation fields', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 7,
        slug: 'black-core-tee',
        name: 'Black Core Tee',
        description: 'Camiseta negra',
        collection: 'Core',
        searchKeywords: ['black', 'negro', 'tee'],
        price: 3495,
        currency: 'EUR',
        imageUrl: null,
        images: [{ url: 'https://example.com/black.png' }],
        categories: [{ category: { name: 'Camisetas', slug: 'camisetas' } }],
      },
    ]);
    const service = new ProductService({ product: { findMany } } as any);

    await expect(
      service.getSearchSuggestions({ search: 'negro', limit: 8 }),
    ).resolves.toEqual({
      items: [
        {
          id: 7,
          slug: 'black-core-tee',
          name: 'Black Core Tee',
          price: 3495,
          currency: 'EUR',
          imageUrl: 'https://example.com/black.png',
          category: { name: 'Camisetas', slug: 'camisetas' },
        },
      ],
    });

    const query = findMany.mock.calls[0][0];
    expect(query.where.isActive).toBe(true);
    expect(query.take).toBeLessThanOrEqual(80);
    expect(query.select.variants).toBeUndefined();
  });

  it('ranks all full-search matches and does not expose internal search metadata', async () => {
    const base = {
      description: '',
      collection: null,
      searchKeywords: ['black', 'tee'],
      searchText: 'black tee',
      price: 3495,
      createdAt: new Date('2026-01-01'),
      variants: [],
      images: [],
      categories: [],
    };
    const findMany = jest.fn().mockResolvedValue([
      { ...base, id: 2, slug: 'washed-black-tee', name: 'Washed Black Tee' },
      { ...base, id: 1, slug: 'black-tee', name: 'Black Tee' },
    ]);
    const service = new ProductService({ product: { findMany } } as any);

    const response = await service.getAllProducts({ search: 'black tee' });

    expect(response.items.map((product) => product.id)).toEqual([1, 2]);
    expect(response.items[0]).not.toHaveProperty('searchKeywords');
    expect(response.items[0]).not.toHaveProperty('searchText');
    expect(findMany.mock.calls[0][0].where.isActive).toBe(true);
  });
});
