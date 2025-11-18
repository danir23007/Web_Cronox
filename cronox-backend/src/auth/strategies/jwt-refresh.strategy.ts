import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
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
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractRefreshToken]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: number; type?: string }) {
    const refreshToken = (req as Request & { refreshToken?: string }).refreshToken;

    if (!refreshToken || payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const userId = Number(payload.sub);

    if (!Number.isFinite(userId)) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    return this.usersService.toSafeUser(user);
  }
}
