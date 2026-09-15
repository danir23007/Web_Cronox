import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '@prisma/client';
import { isSuperAdminRole } from '../roles.utils';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const role = request.user?.role as Role | null | undefined;
    if (!isSuperAdminRole(role)) {
      throw new ForbiddenException(
        'Solo un Super Admin puede modificar usuarios',
      );
    }
    return true;
  }
}
