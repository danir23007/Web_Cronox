import { Role } from '@prisma/client';

export const ADMIN_ROLES = new Set<Role>([Role.ADMIN, Role.SUPERADMIN]);

export const ADMIN_ROLE_LIST = Array.from(ADMIN_ROLES);

export const normalizeRole = (role?: Role | null): Role | null => {
  if (!role || !Object.values(Role).includes(role)) return null;
  return role;
};

export const isAdminRole = (role?: Role | null): boolean => {
  const effectiveRole = normalizeRole(role);
  if (!effectiveRole) return false;
  return ADMIN_ROLES.has(effectiveRole);
};

export const isSuperAdminRole = (role?: Role | null): boolean =>
  role === Role.SUPERADMIN;

export const isAdminPanelRole = (role?: Role | null): boolean =>
  role === Role.ADMIN || isSuperAdminRole(role);

export const hasAnyRole = (role: Role | null | undefined, allowed: Role[]) => {
  const effectiveRole = normalizeRole(role);
  if (!effectiveRole) return false;
  if (isAdminPanelRole(effectiveRole)) return true;
  return allowed.includes(effectiveRole);
};
