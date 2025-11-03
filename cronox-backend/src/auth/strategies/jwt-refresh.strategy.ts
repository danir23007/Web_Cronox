import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        JwtRefreshStrategy.extractToken,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh',
      passReqToCallback: true,
    });
  }

  private static extractToken(req: Request): string | null {
    if (!req) {
      return null;
    }

    const bodyToken = req.body?.refreshToken;
    if (typeof bodyToken === 'string' && bodyToken.length > 0) {
      (req as Request & { refreshToken?: string }).refreshToken = bodyToken;
      return bodyToken;
    }

    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      const token = authorization.slice(7);
      (req as Request & { refreshToken?: string }).refreshToken = token;
      return token;
    }

    return null;
  }

  async validate(req: Request, payload: { sub: string; type?: string }) {
    const refreshToken = (req as Request & { refreshToken?: string }).refreshToken;
    if (!refreshToken || payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const isValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!isValid) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    return this.usersService.toPublic(user);
  }
}
