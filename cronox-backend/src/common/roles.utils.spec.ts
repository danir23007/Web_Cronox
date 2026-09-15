import { Role } from '@prisma/client';
import {
  ADMIN_ROLE_LIST,
  hasAnyRole,
  isAdminPanelRole,
  isAdminRole,
  isSuperAdminRole,
  normalizeRole,
} from './roles.utils';

describe('role normalization', () => {
  it('fails closed for missing roles', () => {
    expect(normalizeRole(null)).toBeNull();
    expect(isAdminRole(null)).toBe(false);
    expect(isSuperAdminRole(undefined)).toBe(false);
    expect(hasAnyRole(null, [Role.SUPERADMIN])).toBe(false);
  });

  it('recognizes only the canonical Super Admin value', () => {
    expect(normalizeRole(Role.SUPERADMIN)).toBe(Role.SUPERADMIN);
    expect(isSuperAdminRole(Role.SUPERADMIN)).toBe(true);
    expect(ADMIN_ROLE_LIST).toContain(Role.SUPERADMIN);
    expect(normalizeRole(Role.ADMIN)).toBe(Role.ADMIN);
    expect(isAdminRole(Role.ADMIN)).toBe(true);
    expect(isSuperAdminRole(Role.ADMIN)).toBe(false);
    expect(isAdminPanelRole(Role.ADMIN)).toBe(true);
    expect(isAdminPanelRole(Role.SUPERADMIN)).toBe(true);
    expect(ADMIN_ROLE_LIST).toContain(Role.ADMIN);
    expect(normalizeRole('SUPER_ADMIN' as Role)).toBeNull();
    expect(isSuperAdminRole('SUPER_ADMIN' as Role)).toBe(false);
    expect(isAdminPanelRole('SUPER_ADMIN' as Role)).toBe(false);
  });

  it('does not grant customer roles access to the admin panel', () => {
    expect(isAdminPanelRole(Role.FRIEND)).toBe(false);
    expect(isAdminPanelRole(Role.USER)).toBe(false);
  });

  it('keeps ADMIN and SUPERADMIN administrative permissions', () => {
    expect(hasAnyRole(Role.ADMIN, [Role.SUPERADMIN])).toBe(true);
    expect(hasAnyRole(Role.SUPERADMIN, [Role.ADMIN])).toBe(true);
    expect(hasAnyRole(Role.FRIEND, [Role.ADMIN])).toBe(false);
  });
});
