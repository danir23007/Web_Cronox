import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto } from '../addresses/dto/create-address.dto';
import { UpsertAddressDto } from '../me/dto/upsert-address.dto';

const validAddress = {
  name: 'Daniel Rivas',
  line1: 'Calle Mayor 1',
  city: 'Madrid',
  zip: '28001',
};

describe('address country DTO normalization', () => {
  it.each([CreateAddressDto, UpsertAddressDto])(
    '%p accepts legacy ES but transforms it to España',
    async (Dto) => {
      const instance = plainToInstance(Dto, {
        ...validAddress,
        country: 'ES',
      });
      expect(await validate(instance)).toHaveLength(0);
      expect(instance.country).toBe('España');
    },
  );

  it.each([CreateAddressDto, UpsertAddressDto])(
    '%p rejects unsupported countries with the Spain-only validation rule',
    async (Dto) => {
      const instance = plainToInstance(Dto, {
        ...validAddress,
        country: 'France',
      });
      const errors = await validate(instance);
      expect(errors.some((error) => error.property === 'country')).toBe(true);
      expect(JSON.stringify(errors)).toContain(
        'Solo se admite España como país o región.',
      );
    },
  );
});
