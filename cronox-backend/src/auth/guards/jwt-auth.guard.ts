import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { clearFailedSession } from '../session-cookies';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  handleRequest<TUser = Express.User>(
    err: unknown,
    user: TUser | false | null,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request?.path || request?.url || '';
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const hasJwtCookie = Boolean(cookies?.jwt);
    const infoMessage = info instanceof Error ? info.message : '';

    if (err || !user) {
      clearFailedSession(context.switchToHttp().getResponse(), err);
      if (path.includes('/me')) {
        if (!hasJwtCookie) {
          this.logger.warn(`Solicitud a ${path} sin cookie jwt`);
        } else if (infoMessage) {
          this.logger.warn(`Token JWT inválido para ${path}: ${infoMessage}`);
        } else {
          this.logger.warn(`No se pudo autenticar solicitud a ${path}`);
        }
      }
      if (err instanceof Error) throw err;
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return user as TUser;
  }
}
