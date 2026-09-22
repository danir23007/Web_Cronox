import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthSession, Role, User, UserAccountState } from '@prisma/client';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getRequiredJwtSecret } from '../common/config/environment';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_TOKEN_SECONDS,
  ADMIN_IDLE_MS,
  PERSISTENT_SESSION_SECONDS,
  refreshExpiresAt,
  refreshLifetimeSeconds,
} from './session-policy';

export const SESSION_IDLE_MS = ADMIN_IDLE_MS;
export const ACTIVITY_WRITE_MS = 3 * 60_000;
export const REFRESH_RACE_MS = 15_000;
export type SessionClaims = {
  sub: number;
  sv: number;
  sid?: string;
  type?: string;
  generation?: number;
};
type SessionWithUser = AuthSession & { user: User };
type SessionTokens = {
  idleExpiresAt?: number;
  refreshExpiresAt: Date;
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthSessionsService {
  private readonly jwt = new JwtService();
  private nextCleanupAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  private denied(code = 'SESSION_INVALID'): never {
    throw new UnauthorizedException({
      code,
      message:
        code === 'SESSION_IDLE'
          ? 'Tu sesión se ha cerrado por inactividad.'
          : 'Inicia sesión de nuevo.',
    });
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashesEqual(left: string, right: string | null): boolean {
    if (!right || left.length !== right.length) return false;
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  }

  // No raw token is persisted. The exact current JWT can be reconstructed so
  // racing requests receive the SAME replacement, not competing descendants.
  private refreshToken(
    session: Pick<
      AuthSession,
      'id' | 'userId' | 'sessionVersion' | 'generation' | 'refreshIssuedAt'
    >,
    role: Role,
  ) {
    return this.jwt.sign(
      {
        sub: session.userId,
        sv: session.sessionVersion,
        sid: session.id,
        type: 'refresh',
        generation: session.generation,
        iat: session.refreshIssuedAt,
        exp: session.refreshIssuedAt + refreshLifetimeSeconds(role),
      },
      {
        secret: getRequiredJwtSecret('JWT_REFRESH_SECRET'),
        algorithm: 'HS256',
      },
    );
  }

  private tokens(session: AuthSession, role: Role): SessionTokens {
    return {
      idleExpiresAt:
        role === Role.ADMIN
          ? session.lastActivityAt.getTime() + SESSION_IDLE_MS
          : undefined,
      refreshExpiresAt: refreshExpiresAt(session.refreshIssuedAt, role),
      accessToken: this.jwt.sign(
        {
          sub: session.userId,
          sv: session.sessionVersion,
          sid: session.id,
          type: 'access',
        },
        {
          secret: getRequiredJwtSecret('JWT_ACCESS_SECRET'),
          algorithm: 'HS256',
          expiresIn: ACCESS_TOKEN_SECONDS,
        },
      ),
      refreshToken: this.refreshToken(session, role),
    };
  }

  async create(user: {
    id: number;
    sessionVersion: number;
    role: Role;
  }): Promise<SessionTokens> {
    const now = new Date();
    // Opportunistic cleanup, at most hourly per worker, only auth-session rows.
    // Remove revoked rows and expired sessions after a short replay window.
    // Persistent sessions must never be deleted after just seven idle days.
    if (now.getTime() >= this.nextCleanupAt) {
      await this.prisma.authSession.deleteMany({
        where: {
          OR: [
            { revokedAt: { lt: new Date(now.getTime() - 7 * 86400_000) } },
            {
              user: { role: Role.ADMIN },
              lastActivityAt: { lt: new Date(now.getTime() - 7 * 86400_000) },
            },
            {
              refreshIssuedAt: {
                lt:
                  Math.floor(now.getTime() / 1000) -
                  PERSISTENT_SESSION_SECONDS -
                  7 * 86400,
              },
            },
          ],
        },
      });
      this.nextCleanupAt = now.getTime() + 3600_000;
    }
    const data = {
      id: randomUUID(),
      userId: user.id,
      sessionVersion: user.sessionVersion,
      generation: 0,
      refreshIssuedAt: Math.floor(now.getTime() / 1000),
      lastActivityAt: now,
    };
    const session = await this.prisma.authSession.create({
      data: {
        ...data,
        refreshHash: this.hash(this.refreshToken(data, user.role)),
      },
    });
    return this.tokens(session, user.role);
  }

  async validate(payload: SessionClaims): Promise<SessionWithUser> {
    if (!payload.sid) this.denied('SESSION_REAUTH_REQUIRED');
    if (!Number.isInteger(payload.sub) || !Number.isInteger(payload.sv))
      this.denied();
    const session: SessionWithUser | null =
      await this.prisma.authSession.findUnique({
        where: { id: payload.sid },
        include: { user: true },
      });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.sessionVersion !== payload.sv ||
      session.revokedAt ||
      session.user.sessionVersion !== payload.sv ||
      session.user.accountState !== UserAccountState.ACTIVE ||
      !Object.values(Role).includes(session.user.role)
    )
      this.denied();
    if (
      refreshExpiresAt(session.refreshIssuedAt, session.user.role).getTime() <=
      Date.now()
    ) {
      await this.revoke(session.id);
      this.denied('SESSION_EXPIRED');
    }
    if (
      session.user.role === Role.ADMIN &&
      session.lastActivityAt.getTime() <= Date.now() - SESSION_IDLE_MS
    ) {
      // Conditional revocation cannot race a successful activity touch.
      const expired = await this.prisma.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          lastActivityAt: { lte: new Date(Date.now() - SESSION_IDLE_MS) },
        },
        data: { revokedAt: new Date() },
      });
      if (expired.count) this.denied('SESSION_IDLE');
      return this.validate(payload);
    }
    return session;
  }

  async verify(
    token: string | undefined,
    type: 'access' | 'refresh',
  ): Promise<SessionWithUser> {
    if (!token) this.denied();
    let payload: SessionClaims;
    try {
      payload = await this.jwt.verifyAsync<SessionClaims>(token, {
        secret: getRequiredJwtSecret(
          type === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET',
        ),
        algorithms: ['HS256'],
      });
    } catch {
      this.denied();
    }
    if (payload.type !== type) {
      if (!payload.sid) this.denied('SESSION_REAUTH_REQUIRED');
      this.denied();
    }
    const session = await this.validate(payload);
    if (type === 'refresh') {
      const hash = this.hash(token);
      if (
        !this.hashesEqual(hash, session.refreshHash) &&
        !(
          this.hashesEqual(hash, session.previousRefreshHash) &&
          session.previousValidUntil &&
          session.previousValidUntil.getTime() > Date.now()
        )
      ) {
        await this.revoke(session.id);
        this.denied();
      }
    }
    return session;
  }

  async rotate(token: string): Promise<SessionTokens> {
    const session = await this.verify(token, 'refresh');
    const now = new Date();
    // A repeat during grace must not advance the family again.
    if (session.previousValidUntil && session.previousValidUntil > now)
      return this.tokens(session, session.user.role);
    const next = {
      ...session,
      generation: session.generation + 1,
      refreshIssuedAt: Math.floor(now.getTime() / 1000),
    };
    const changed = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        generation: session.generation,
        revokedAt: null,
        ...(session.user.role === Role.ADMIN
          ? {
              lastActivityAt: { gt: new Date(now.getTime() - SESSION_IDLE_MS) },
            }
          : {}),
        refreshIssuedAt: {
          gt:
            Math.floor(now.getTime() / 1000) -
            refreshLifetimeSeconds(session.user.role),
        },
        user: {
          sessionVersion: session.sessionVersion,
          accountState: UserAccountState.ACTIVE,
        },
      },
      data: {
        generation: next.generation,
        refreshIssuedAt: next.refreshIssuedAt,
        refreshHash: this.hash(this.refreshToken(next, session.user.role)),
        previousRefreshHash: session.refreshHash,
        previousValidUntil: new Date(now.getTime() + REFRESH_RACE_MS),
      },
    });
    if (!changed.count) {
      const winner = await this.verify(token, 'refresh');
      return this.tokens(winner, winner.user.role);
    }
    return this.tokens(next, session.user.role);
  }

  async touch(payload: SessionClaims): Promise<{ idleExpiresAt: number }> {
    const session = await this.validate(payload);
    if (session.user.role !== Role.ADMIN) return { idleExpiresAt: 0 };
    const now = new Date();
    if (now.getTime() - session.lastActivityAt.getTime() < ACTIVITY_WRITE_MS) {
      return {
        idleExpiresAt: session.lastActivityAt.getTime() + SESSION_IDLE_MS,
      };
    }
    await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        lastActivityAt: {
          gt: new Date(now.getTime() - SESSION_IDLE_MS),
          lte: new Date(now.getTime() - ACTIVITY_WRITE_MS),
        },
        user: {
          sessionVersion: payload.sv,
          accountState: UserAccountState.ACTIVE,
        },
      },
      data: { lastActivityAt: now },
    });
    const current = await this.validate(payload);
    return {
      idleExpiresAt: current.lastActivityAt.getTime() + SESSION_IDLE_MS,
    };
  }

  async revoke(id: string) {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
