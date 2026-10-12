import { validate } from 'class-validator';
import { countsInStatistics } from './statistics-eligibility';
import { CreateCheckoutSessionDto } from '../orders/dto/create-checkout-session.dto';
import { SaleDto } from '../admin/points/point.dto';

describe('manual statistics exception scope', () => {
  it('includes every legacy order and web order, excluding only explicitly marked manual purchases', () => {
    expect(countsInStatistics({ source: 'IN_PERSON_ADMIN' })).toBe(true);
    expect(countsInStatistics({ source: 'IN_PERSON_ADMIN', excludedFromStatistics: false })).toBe(true);
    expect(countsInStatistics({ source: 'IN_PERSON_ADMIN', excludedFromStatistics: true })).toBe(false);
    expect(countsInStatistics({ source: 'ONLINE', excludedFromStatistics: true })).toBe(true);
  });
  it.each([true, false, null])('rejects a supplied exclusion value %s on checkout and point-sale DTOs', async value => {
    for (const Dto of [CreateCheckoutSessionDto, SaleDto]) {
      const errors = await validate(Object.assign(new Dto(), { excludedFromStatistics: value }));
      expect(errors.some(error => error.property === 'excludedFromStatistics')).toBe(true);
    }
  });
});
