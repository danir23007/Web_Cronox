import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from '../auth/dto/register.dto';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateAccountName } from './account-name-policy';

describe('new account name limits with unchanged historical values', () => {
  it('only permits omitting the last name in the explicit newsletter context, never the first name', async () => {
    const data = { email: 'local@name.test', password: 'LocalPassword', firstName: 'Persona' };
    expect((await validate(plainToInstance(RegisterDto, data))).map(f => f.property)).toContain('lastName');
    expect(await validate(plainToInstance(RegisterDto, { ...data, registrationSource: 'newsletter' }))).toHaveLength(0);
    expect((await validate(plainToInstance(RegisterDto, { ...data, firstName: undefined, registrationSource: 'newsletter' }))).map(f => f.property)).toContain('firstName');
    expect((await validate(plainToInstance(RegisterDto, { ...data, registrationSource: 'other' }))).map(f => f.property)).toContain('registrationSource');
  });
  it.each([
    ['firstName', 25],
    ['lastName', 30],
  ] as const)(
    '%s accepts exactly %i characters and rejects one more',
    (field, limit) => {
      expect(() => validateAccountName('Á'.repeat(limit), field)).not.toThrow();
      expect(() => validateAccountName('Á'.repeat(limit + 1), field)).toThrow(
        BadRequestException,
      );
      const historical = 'Á'.repeat(120);
      expect(() =>
        validateAccountName(historical, field, historical),
      ).not.toThrow();
      expect(() =>
        validateAccountName(historical.slice(0, 119), field, historical),
      ).toThrow(BadRequestException);
    },
  );
  it('registration validation rejects oversize values before any account creation', async () => {
    const valid = {
      email: 'local@name.test',
      password: 'LocalPassword',
      firstName: 'A'.repeat(25),
      lastName: 'B'.repeat(30),
    };
    expect(await validate(plainToInstance(RegisterDto, valid))).toHaveLength(0);
    const failures = await validate(
      plainToInstance(RegisterDto, {
        ...valid,
        firstName: 'A'.repeat(26),
        lastName: 'B'.repeat(31),
      }),
    );
    expect(failures.map((f) => f.property).sort()).toEqual([
      'firstName',
      'lastName',
    ]);
    const transaction = jest.fn();
    const service = new UsersService({
      $transaction: transaction,
    } as unknown as PrismaService);
    await expect(
      service.createUser({ ...valid, firstName: 'A'.repeat(26) }),
    ).rejects.toThrow('25');
    expect(transaction).not.toHaveBeenCalled();
  });
});
