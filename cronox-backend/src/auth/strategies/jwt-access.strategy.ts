import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { getRequiredJwtSecret } from '../../common/config/environment';
import { UsersService } from '../../users/users.service';
import { UserAccountState } from '@prisma/client';
import { AuthSessionsService, SessionClaims } from '../auth-sessions.service';

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
  constructor(
    private readonly usersService: UsersService,
    private readonly sessions: AuthSessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractAccessToken]),
      ignoreExpiration: false,
      secretOrKey: getRequiredJwtSecret('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    payload: { sub: number; sv?: number; sid?: string; type?: string },
  ) {
    const userId = Number(payload?.sub);

    if (!Number.isFinite(userId)) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(userId);

    if (
      !user ||
      user.accountState !== UserAccountState.ACTIVE ||
      !Number.isInteger(payload.sv) ||
      payload.sv !== user.sessionVersion
    ) {
      throw new UnauthorizedException();
    }

    if (payload.type !== 'access' && payload.sid)
      throw new UnauthorizedException();
    const session = await this.sessions.validate(payload as SessionClaims);
    (req as Request & { authSession?: SessionClaims }).authSession =
      payload as SessionClaims;
    req.res?.setHeader(
      'X-Session-Idle-Expires',
      String(session.lastActivityAt.getTime() + 90 * 60_000),
    );
    return this.usersService.toSafeUser(user);
  }
}
