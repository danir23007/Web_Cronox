import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductDto } from './update-product.dto';

describe.each([CreateProductDto, UpdateProductDto])('last units DTO %s', Dto => {
  it.each([null, undefined, 0, 1, 5, 2147483647])('accepts %s', async value => {
    const dto = plainToInstance(Dto, { name: 'QA', price: 100, lastUnitsThreshold: value });
    expect((await validate(dto)).filter(error => error.property === 'lastUnitsThreshold')).toEqual([]);
  });
  it.each([-1, 1.5, '5', '', false, {}, [], 2147483648])('rejects %s', async value => {
    const dto = plainToInstance(Dto, { name: 'QA', price: 100, lastUnitsThreshold: value });
    expect((await validate(dto)).some(error => error.property === 'lastUnitsThreshold')).toBe(true);
  });
});
