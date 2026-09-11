import { Role } from '@prisma/client';

export const ADMIN_ROLES = new Set<Role>([
  Role.SUPER_ADMIN,
  Role.MODERATOR,
  Role.LOGISTICS,
  Role.MARKETING,
]);

// Keep legacy full-administrator records in aggregate queries until the
// database values have been normalized.
export const ADMIN_ROLE_LIST = Array.from(
  new Set<Role>([...ADMIN_ROLES, Role.ADMIN, Role.SUPERADMIN]),
);

export const normalizeRole = (role?: Role | null): Role | null => {
  if (!role) return null;
  if (role === Role.ADMIN || role === Role.SUPERADMIN) {
    return Role.SUPER_ADMIN;
  }
  return role;
};

export const isAdminRole = (role?: Role | null): boolean => {
  const effectiveRole = normalizeRole(role);
  if (!effectiveRole) return false;
  return ADMIN_ROLES.has(effectiveRole);
};

export const isSuperAdminRole = (role?: Role | null): boolean =>
  normalizeRole(role) === Role.SUPER_ADMIN;

export const hasAnyRole = (role: Role | null | undefined, allowed: Role[]) => {
  const effectiveRole = normalizeRole(role);
  if (!effectiveRole) return false;
  if (effectiveRole === Role.SUPER_ADMIN) return true;
  return allowed.includes(effectiveRole);
};
