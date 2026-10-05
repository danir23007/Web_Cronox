import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { getRequiredJwtSecret } from '../../common/config/environment';
import { UsersService } from '../../users/users.service';
import { Role } from '@prisma/client';
import { AuthSessionsService, SessionClaims } from '../auth-sessions.service';
import { ADMIN_IDLE_MS } from '../session-policy';

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

    if (payload.type !== 'access' && payload.sid)
      throw new UnauthorizedException();
    const session = await this.sessions.validate(payload as SessionClaims);
    // validate reads the current user with the session and checks revocation,
    // account state, version, role and expiry. Do not read that user twice.
    const user = session.user;
    (req as Request & { authSession?: SessionClaims }).authSession =
      payload as SessionClaims;
    if (user.role === Role.ADMIN)
      req.res?.setHeader(
        'X-Session-Idle-Expires',
        String(session.lastActivityAt.getTime() + ADMIN_IDLE_MS),
      );
    return this.usersService.toSafeUser(user);
  }
}
