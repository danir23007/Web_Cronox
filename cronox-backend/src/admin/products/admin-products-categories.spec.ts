/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { validate } from 'class-validator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminProductsController } from './admin-products.controller';
import { UpdateProductCategoriesDto } from './dto/update-product-categories.dto';

describe('Admin product category endpoint', () => {
  it('rejects non-admin users through the existing admin authorization policy', () => {
    const controller = new AdminProductsController({} as any, {} as any);
    const guard = new AdminGuard(new Reflector());
    const context = {
      getHandler: () => controller.updateCategories,
      getClass: () => AdminProductsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: Role.USER } }),
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it.each([[[1, 1]], [[0]], [[-1]], [[1.2]], ['not-an-array']])(
    'DTO validation rejects invalid IDs: %j',
    async (categoryIds) => {
      const dto = new UpdateProductCategoriesDto();
      (dto as any).categoryIds = categoryIds;

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    },
  );

  it('accepts an empty array so all assignments can be removed', async () => {
    const dto = new UpdateProductCategoriesDto();
    dto.categoryIds = [];

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
