import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { getRequiredJwtSecret } from '../../common/config/environment';
import { UsersService } from '../../users/users.service';

const extractRefreshToken = (req: Request): string | null => {
  if (!req) {
    return null;
  }

  const tokenFromCookie = req.cookies?.refresh_token;
  if (tokenFromCookie) {
    (req as Request & { refreshToken?: string }).refreshToken = tokenFromCookie;
    return tokenFromCookie;
  }

  return null;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractRefreshToken]),
      ignoreExpiration: false,
      secretOrKey: getRequiredJwtSecret('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    payload: { sub: number; type?: string; sv?: number },
  ) {
    const refreshToken = (req as Request & { refreshToken?: string })
      .refreshToken;

    if (!refreshToken || payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const userId = Number(payload.sub);

    if (!Number.isFinite(userId)) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const user = await this.usersService.findById(userId);

    if (
      !user ||
      !Number.isInteger(payload.sv) ||
      payload.sv !== user.sessionVersion
    ) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    return this.usersService.toSafeUser(user);
  }
}
