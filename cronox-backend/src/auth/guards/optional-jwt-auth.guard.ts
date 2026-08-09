import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = Express.User | undefined>(
    err: unknown,
    user: Express.User | false | null,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err) {
      if (err instanceof Error) throw err;
      throw new UnauthorizedException('Usuario no autenticado');
    }

    if (user) {
      return user as TUser;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const hasAccessToken = Boolean(
      (typeof cookies?.jwt === 'string' && cookies.jwt) ||
        request.headers?.authorization,
    );

    // Optional means no credentials are required. Credentials that are
    // present but invalid must not silently downgrade an account request to a
    // guest cart, because that recreates the split-cart failure.
    if (hasAccessToken) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return undefined as TUser;
  }
}
