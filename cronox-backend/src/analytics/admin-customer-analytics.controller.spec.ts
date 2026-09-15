import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../common/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminCustomerAnalyticsController } from './admin-customer-analytics.controller';

describe('AdminCustomerAnalyticsController authorization', () => {
  const context = (
    handler: keyof AdminCustomerAnalyticsController,
    role: Role,
  ) =>
    ({
      getHandler: () => AdminCustomerAnalyticsController.prototype[handler],
      getClass: () => AdminCustomerAnalyticsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as unknown as ExecutionContext;
  const guard = new RolesGuard(new Reflector());

  it('uses the canonical SUPERADMIN role on every analytics endpoint', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminCustomerAnalyticsController),
    ).toEqual([Role.SUPERADMIN]);
  });

  it('allows SUPERADMIN to access customer analytics', () => {
    expect(guard.canActivate(context('summary', Role.SUPERADMIN))).toBe(true);
  });

  it('allows SUPERADMIN to access login history', () => {
    expect(guard.canActivate(context('logins', Role.SUPERADMIN))).toBe(true);
  });

  it('keeps ADMIN access to existing administrative analytics', () => {
    expect(guard.canActivate(context('summary', Role.ADMIN))).toBe(true);
    expect(guard.canActivate(context('logins', Role.ADMIN))).toBe(true);
  });

  it('rejects normal users from customer analytics and login history', () => {
    expect(() => guard.canActivate(context('summary', Role.USER))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context('logins', Role.USER))).toThrow(
      ForbiddenException,
    );
  });
});
