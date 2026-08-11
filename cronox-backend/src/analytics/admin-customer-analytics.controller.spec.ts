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

  it('limits every customer analytics and login-history endpoint to SUPER_ADMIN and MODERATOR', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminCustomerAnalyticsController),
    ).toEqual([Role.SUPER_ADMIN, Role.MODERATOR]);
  });

  it('allows SUPER_ADMIN to access customer analytics', () => {
    expect(guard.canActivate(context('summary', Role.SUPER_ADMIN))).toBe(true);
  });

  it('allows SUPER_ADMIN to access login history', () => {
    expect(guard.canActivate(context('logins', Role.SUPER_ADMIN))).toBe(true);
  });

  it('allows MODERATOR to access customer analytics', () => {
    expect(guard.canActivate(context('summary', Role.MODERATOR))).toBe(true);
  });

  it('allows MODERATOR to access login history', () => {
    expect(guard.canActivate(context('logins', Role.MODERATOR))).toBe(true);
  });

  it('does not treat the legacy ADMIN enum value as an authorized admin role', () => {
    expect(() => guard.canActivate(context('summary', Role.ADMIN))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context('logins', Role.ADMIN))).toThrow(
      ForbiddenException,
    );
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
