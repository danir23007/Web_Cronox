import { ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  handleRequest(err: unknown, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request?.path || request?.url || '';
    const hasJwtCookie = Boolean(request?.cookies?.jwt);

    if (err || !user) {
      if (path.includes('/me')) {
        if (!hasJwtCookie) {
          this.logger.warn(`Solicitud a ${path} sin cookie jwt`);
        } else if (info?.message) {
          this.logger.warn(`Token JWT inválido para ${path}: ${info.message}`);
        } else {
          this.logger.warn(`No se pudo autenticar solicitud a ${path}`);
        }
      }
      throw err || new UnauthorizedException('Usuario no autenticado');
    }

    return user;
  }
}
