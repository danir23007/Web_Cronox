import { BadRequestException } from '@nestjs/common';
import {
  assertSizesMatchSystem,
  PRODUCT_SIZE_SYSTEMS,
  sizeOrder,
  variantSizeLabel,
  variantSizeSkuToken,
} from './product-size-system';

describe('product size systems', () => {
  it('defines the exact apparel and US ring sizes in canonical order', () => {
    expect(PRODUCT_SIZE_SYSTEMS.APPAREL).toEqual([
      'XS',
      'S',
      'M',
      'L',
      'XL',
      'XXL',
    ]);
    expect(PRODUCT_SIZE_SYSTEMS.US_RING).toEqual([
      'US_6',
      'US_7',
      'US_8',
      'US_9',
      'US_10',
      'US_11',
      'US_12',
    ]);
  });

  it('provides semantic display labels, SKU tokens and sorting', () => {
    expect(variantSizeLabel('US_10')).toBe('US 10');
    expect(variantSizeSkuToken('US_10')).toBe('US10');
    expect(sizeOrder('US_6')).toBeLessThan(sizeOrder('US_12'));
  });

  it('rejects sizes belonging to another system', () => {
    expect(() => assertSizesMatchSystem('US_RING', ['M'])).toThrow(
      BadRequestException,
    );
    expect(() => assertSizesMatchSystem('APPAREL', ['US_8'])).toThrow(
      BadRequestException,
    );
  });
});
