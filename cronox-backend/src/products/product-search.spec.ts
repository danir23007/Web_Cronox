import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductSuggestionsQueryDto } from './dto/product-suggestions-query.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import {
  buildProductSearchText,
  expandSearchTokens,
  normalizeSearchKeywords,
  normalizeSearchText,
  scoreProductSearch,
} from './product-search';

describe('product search helpers', () => {
  it('validates public search length and caps suggestion limits', async () => {
    const tooLong = plainToInstance(QueryProductsDto, {
      search: 'a'.repeat(101),
    });
    const tooManySuggestions = plainToInstance(ProductSuggestionsQueryDto, {
      search: 'black',
      limit: 9,
    });

    await expect(validate(tooLong)).resolves.not.toHaveLength(0);
    await expect(validate(tooManySuggestions)).resolves.not.toHaveLength(0);
  });

  it('normalizes accents, casing, punctuation and whitespace', () => {
    expect(normalizeSearchText('  PANTALÓN   Azul  ')).toBe('pantalon azul');
    expect(normalizeSearchText('T-Shirt')).toBe('tshirt');
  });

  it('normalizes comma-separated keywords and removes duplicates', () => {
    expect(
      normalizeSearchKeywords([' Azul, blue ', 'CAMISETA', 'azul', '']),
    ).toEqual(['azul', 'blue', 'camiseta']);
  });

  it('expands Spanish and English color and garment equivalents', () => {
    expect(expandSearchTokens('negro camiseta')).toEqual([
      expect.arrayContaining(['negro', 'black']),
      expect.arrayContaining(['camiseta', 'tee', 'tshirt']),
    ]);
  });

  it('builds searchable metadata from reliable product fields', () => {
    expect(
      buildProductSearchText({
        name: 'Core Tee',
        slug: 'core-tee',
        description: 'Algodón lavado',
        collection: 'Drop 01',
        searchKeywords: ['azul', 'blue'],
      }),
    ).toBe('core tee core tee algodon lavado drop 01 azul blue');
  });

  it('ranks exact, prefix, name, metadata and description matches in order', () => {
    const query = 'black tee';
    const exact = scoreProductSearch({ name: 'Black Tee' }, query);
    const prefix = scoreProductSearch({ name: 'Black Tee Washed' }, query);
    const name = scoreProductSearch({ name: 'Washed Black Tee' }, query);
    const keyword = scoreProductSearch(
      { name: 'Core', searchKeywords: ['black', 'tee'] },
      query,
    );
    const description = scoreProductSearch(
      { name: 'Core', description: 'Black washed tee' },
      query,
    );

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(name);
    expect(name).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(description);
  });
});
