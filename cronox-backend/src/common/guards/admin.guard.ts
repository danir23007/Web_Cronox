import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const role = request.user?.role as Role | undefined;

    if (role !== Role.ADMIN && role !== Role.SUPERADMIN) {
      throw new ForbiddenException('Solo los administradores pueden acceder');
    }

    return true;
  }
}
