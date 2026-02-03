import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '@prisma/client';
import { isAdminRole } from '../roles.utils';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const role = request.user?.role as Role | null | undefined;

    if (!isAdminRole(role)) {
      throw new ForbiddenException('Solo los administradores pueden acceder');
    }

    return true;
  }
}
