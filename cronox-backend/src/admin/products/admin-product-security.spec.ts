/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/roles.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminProductsController } from './admin-products.controller';
import { ForbiddenException } from '@nestjs/common';

describe('AdminProductsController security', () => {
  it('protects deletion and all product management with JWT and admin authorization', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, AdminProductsController) || [];
    const roles = Reflect.getMetadata(ROLES_KEY, AdminProductsController) || [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(AdminGuard);
    expect(roles).toEqual([Role.SUPERADMIN]);
    expect(roles).not.toContain(Role.USER);
  });

  it('rejects a non-administrator', () => {
    const guard = new AdminGuard({
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([Role.SUPERADMIN]),
    } as any);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: Role.USER } }),
      }),
      getHandler: () => AdminProductsController.prototype.deleteProduct,
      getClass: () => AdminProductsController,
    } as any;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
