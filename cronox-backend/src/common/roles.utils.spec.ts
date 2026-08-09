import { Role } from '@prisma/client';
import {
  ADMIN_ROLE_LIST,
  hasAnyRole,
  isAdminRole,
  isSuperAdminRole,
  normalizeRole,
} from './roles.utils';

describe('role normalization', () => {
  it('fails closed for missing roles', () => {
    expect(normalizeRole(null)).toBeNull();
    expect(isAdminRole(null)).toBe(false);
    expect(isSuperAdminRole(undefined)).toBe(false);
    expect(hasAnyRole(null, [Role.SUPER_ADMIN])).toBe(false);
  });

  it('only maps the legacy SUPERADMIN value to super-admin', () => {
    expect(normalizeRole(Role.SUPERADMIN)).toBe(Role.SUPER_ADMIN);
    expect(isSuperAdminRole(Role.SUPERADMIN)).toBe(true);
    expect(ADMIN_ROLE_LIST).toContain(Role.SUPERADMIN);
    expect(normalizeRole(Role.ADMIN)).toBe(Role.ADMIN);
    expect(isAdminRole(Role.ADMIN)).toBe(false);
  });

  it('allows scoped staff roles only when explicitly listed', () => {
    expect(hasAnyRole(Role.LOGISTICS, [Role.LOGISTICS])).toBe(true);
    expect(hasAnyRole(Role.LOGISTICS, [Role.MARKETING])).toBe(false);
    expect(hasAnyRole(Role.SUPER_ADMIN, [Role.MARKETING])).toBe(true);
  });
});
