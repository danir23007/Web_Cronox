import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/roles.decorator';
import { AdminInventoryController } from './admin-inventory.controller';

describe('AdminInventoryController access control', () => {
  it('requires authentication plus the existing admin and role guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminInventoryController,
    ) as unknown[];
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AdminInventoryController,
    ) as Role[];

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, AdminGuard, RolesGuard]),
    );
    expect(roles).toEqual([Role.SUPERADMIN]);
    expect(roles).not.toContain(Role.USER);
  });
});
