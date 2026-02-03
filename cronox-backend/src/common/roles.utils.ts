import { Role } from '@prisma/client';

export const ADMIN_ROLES = new Set<Role>([
  Role.SUPER_ADMIN,
  Role.MODERATOR,
  Role.LOGISTICS,
  Role.MARKETING,
  Role.ADMIN,
  Role.SUPERADMIN,
]);

export const ADMIN_ROLE_LIST = Array.from(ADMIN_ROLES);

export const normalizeRole = (role?: Role | null): Role => {
  if (!role) return Role.SUPER_ADMIN;
  if (role === Role.SUPERADMIN || role === Role.ADMIN) {
    return Role.SUPER_ADMIN;
  }
  return role;
};

export const isAdminRole = (role?: Role | null): boolean => {
  const effectiveRole = normalizeRole(role);
  return ADMIN_ROLES.has(effectiveRole);
};

export const isSuperAdminRole = (role?: Role | null): boolean =>
  normalizeRole(role) === Role.SUPER_ADMIN;

export const hasAnyRole = (role: Role | null | undefined, allowed: Role[]) => {
  const effectiveRole = normalizeRole(role);
  if (effectiveRole === Role.SUPER_ADMIN) return true;
  return allowed.includes(effectiveRole);
};
