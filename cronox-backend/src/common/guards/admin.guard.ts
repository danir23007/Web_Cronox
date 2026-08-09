import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../roles.decorator';
import { hasAnyRole, isSuperAdminRole } from '../roles.utils';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const role = request.user?.role as Role | null | undefined;
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      requiredRoles?.length
        ? !hasAnyRole(role, requiredRoles)
        : !isSuperAdminRole(role)
    ) {
      throw new ForbiddenException('Solo los administradores pueden acceder');
    }

    return true;
  }
}
