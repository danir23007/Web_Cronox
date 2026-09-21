import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/roles.decorator';
import { AdminFooterController } from './admin-footer.controller';
import { FooterController } from './footer.controller';

describe('Footer content controller security', () => {
  it('keeps every Admin footer/content route restricted to ADMIN and SUPERADMIN', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminFooterController)).toEqual(
      [JwtAuthGuard, AdminGuard, RolesGuard],
    );
    expect(Reflect.getMetadata(ROLES_KEY, AdminFooterController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('keeps projected public footer and page content readable', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, FooterController),
    ).toBeUndefined();
  });
});
