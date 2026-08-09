import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { getRequiredJwtSecret } from '../../common/config/environment';
import { UsersService } from '../../users/users.service';

const extractAccessToken = (req: Request): string | null => {
  if (!req) {
    return null;
  }

  const tokenFromCookie = req.cookies?.jwt;
  if (tokenFromCookie) {
    return tokenFromCookie;
  }

  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
};

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractAccessToken]),
      ignoreExpiration: false,
      secretOrKey: getRequiredJwtSecret('JWT_ACCESS_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: number; sv?: number }) {
    const userId = Number(payload?.sub);

    if (!Number.isFinite(userId)) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(userId);

    if (
      !user ||
      !Number.isInteger(payload.sv) ||
      payload.sv !== user.sessionVersion
    ) {
      throw new UnauthorizedException();
    }

    return this.usersService.toSafeUser(user);
  }
}
