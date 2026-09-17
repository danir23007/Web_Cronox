import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { clearFailedSession } from '../session-cookies';

@Injectable()
export class RefreshJwtGuard extends AuthGuard('jwt-refresh') {
  handleRequest<TUser>(
    err: unknown,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      clearFailedSession(context.switchToHttp().getResponse(), err, true);
      if (err instanceof Error) throw err;
      throw new UnauthorizedException('Inicia sesión de nuevo.');
    }
    return user;
  }
}
