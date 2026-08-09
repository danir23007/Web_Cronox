import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';
import { CartService, type MergeOnLoginResult } from '../cart/cart.service';
import {
  getBcryptSaltRounds,
  getFrontendUrl,
  isProductionEnvironment,
} from '../common/config/environment';
import { EmailService } from '../email/email.service';
import { NewsletterService } from '../newsletter/newsletter.service';
import {
  CART_COOKIE_NAME,
  getCartCookieOptions,
  LEGACY_CART_COOKIE_PATHS,
} from '../common/cookies/cart-cookie';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService, AuthUser } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

interface JwtPayload {
  sub: number;
  email: string;
  role: Role | null;
  sv: number;
}

type Tokens = {
  accessToken: string;
  refreshToken?: string;
};

type SessionJwtPayload = {
  sub: number;
  sv: number;
  type?: string;
};

@Injectable()
export class AuthService {
  private readonly isProd = isProductionEnvironment();
  private readonly bcryptSaltRounds = getBcryptSaltRounds();
  private readonly dummyPasswordHash = bcrypt.hashSync(
    'CRONOX_NOT_A_REAL_ACCOUNT',
    this.bcryptSaltRounds,
  );
  private readonly logger = new Logger(AuthService.name);

  private readonly jwtCookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    // Production auth cookies must always be HTTPS-only. Environment aliases
    // such as APP_ENV must not be able to silently weaken this invariant.
    secure: this.isProd,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject('JWT_REFRESH_SERVICE') private readonly refreshJwt: JwtService,
    private readonly cartService: CartService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly newsletterService: NewsletterService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.usersService.findByEmail(email);

    if (existing) {
      throw new ConflictException('El email ya esta registrado');
    }

    const hashedPassword = await this.hashPassword(dto.password);
    const fullName = [dto.firstName, dto.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const user = await this.usersService.createUser({
      email,
      password: hashedPassword,
      name: fullName || undefined,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    const authUser = this.omitPassword(user);

    // Only a pre-verified standalone newsletter subscription is claimed here.
    await this.newsletterService.subscribeIfNeeded(user.email);

    const tokens = await this.generateTokens(authUser);

    return {
      user: this.formatAuthUser(authUser),
      token: tokens.accessToken,
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);

    if (!user) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const tokens = await this.generateTokens(user);

    return {
      user: this.formatAuthUser(user),
      token: tokens.accessToken,
      tokens,
    };
  }

  async refresh(userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const authUser = this.omitPassword(user);
    const tokens = await this.generateTokens(authUser);

    return {
      user: this.formatAuthUser(authUser),
      token: tokens.accessToken,
      tokens,
    };
  }

  async getProfile(userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return this.formatAuthUser(this.omitPassword(user));
  }

  async mergeCartOnLogin(
    userId: number,
    cartId?: string,
  ): Promise<MergeOnLoginResult> {
    return this.cartService.mergeOnLogin(userId, cartId);
  }

  logCartMergeResult(_userId: number, result: MergeOnLoginResult) {
    if (result.incidents.length > 0) {
      this.logger.warn('Guest cart merge completed with inventory incidents');
    }
  }

  logCartMergeError(_userId: number, _error: unknown) {
    this.logger.warn('Guest cart merge failed');
  }

  /**
   * Logout is intentionally idempotent. When a current access or refresh
   * cookie validates, compare-and-increment sessionVersion invalidates both
   * token types server-side. Missing or stale cookies are simply cleared by
   * the controller.
   */
  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    const session = await this.getCurrentSession(accessToken, refreshToken);
    if (!session) {
      return;
    }

    await this.prisma.user.updateMany({
      where: { id: session.userId, sessionVersion: session.sessionVersion },
      data: { sessionVersion: { increment: 1 } },
    });
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = email?.trim().toLowerCase() ?? '';
    const [user] = await Promise.all([
      normalizedEmail
        ? this.usersService.findByEmail(normalizedEmail)
        : Promise.resolve(null),
      // Make unknown and known account requests perform comparable bounded work.
      bcrypt.compare(
        normalizedEmail || 'missing-email',
        this.dummyPasswordHash,
      ),
    ]);

    // Return before token persistence and SMTP work in every case. This keeps
    // the externally observable response independent of account existence.
    if (user && this.emailService.isEnabled()) {
      void this.createAndSendPasswordReset(user).catch(() => {
        this.logger.error('Password reset delivery task failed');
      });
    }

    return { ok: true };
  }

  private async createAndSendPasswordReset(
    user: Pick<User, 'id' | 'email'>,
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashResetToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordResetToken.create({
        data: {
          token: tokenHash,
          userId: user.id,
          expiresAt,
        },
      });
    });

    const resetUrl = `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await this.emailService.sendPasswordReset(user.email, resetUrl);
    } catch {
      // Do not leave an actionable token if it could not be delivered.
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, token: tokenHash, usedAt: null },
        data: { usedAt: new Date() },
      });
      this.logger.error('Password reset email delivery failed');
    }
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashResetToken(token);
    const passwordResetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
    });

    if (
      !passwordResetToken ||
      passwordResetToken.usedAt ||
      passwordResetToken.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Token invalido o caducado');
    }

    const hashedPassword = await this.hashPassword(newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: passwordResetToken.id,
          token: tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException('Token invalido o caducado');
      }

      await tx.user.update({
        where: { id: passwordResetToken.userId },
        data: {
          password: hashedPassword,
          sessionVersion: { increment: 1 },
        },
      });

      await tx.passwordResetToken.updateMany({
        where: {
          userId: passwordResetToken.userId,
          id: { not: passwordResetToken.id },
          usedAt: null,
        },
        data: { usedAt: now },
      });
    });

    return { ok: true };
  }

  setAuthCookies(res: Response, tokens: Tokens) {
    res.cookie('jwt', tokens.accessToken, this.jwtCookieOptions);
    if (tokens.refreshToken) {
      res.cookie('refresh_token', tokens.refreshToken, this.jwtCookieOptions);
    }
  }

  clearAuthCookies(res: Response) {
    res.clearCookie('jwt', { ...this.jwtCookieOptions, maxAge: undefined });
    res.clearCookie('refresh_token', {
      ...this.jwtCookieOptions,
      maxAge: undefined,
    });
  }

  clearMergedAnonymousCartCookie(res: Response) {
    for (const path of LEGACY_CART_COOKIE_PATHS) {
      res.clearCookie(CART_COOKIE_NAME, {
        ...getCartCookieOptions(),
        path,
        maxAge: undefined,
      });
    }
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthUser | null> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    const isValid = await bcrypt.compare(
      password,
      user?.password ?? this.dummyPasswordHash,
    );
    if (!user || !isValid) return null;

    return this.omitPassword(user);
  }

  private omitPassword(user: User): AuthUser {
    const { password: _password, ...rest } = user;
    return rest;
  }

  private async generateTokens(user: AuthUser): Promise<Tokens> {
    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.refreshJwt.signAsync({
      sub: user.id,
      type: 'refresh',
      sv: user.sessionVersion,
    });

    return { accessToken, refreshToken };
  }

  private async generateAccessToken(user: AuthUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sv: user.sessionVersion,
    };

    return this.jwtService.signAsync(payload);
  }

  private hashPassword(data: string) {
    return bcrypt.hash(data, this.bcryptSaltRounds);
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async getCurrentSession(
    accessToken?: string,
    refreshToken?: string,
  ): Promise<{ userId: number; sessionVersion: number } | null> {
    if (accessToken) {
      try {
        const payload =
          await this.jwtService.verifyAsync<SessionJwtPayload>(accessToken);
        if (
          payload.type === undefined &&
          Number.isInteger(payload.sub) &&
          Number.isInteger(payload.sv)
        ) {
          return { userId: payload.sub, sessionVersion: payload.sv };
        }
      } catch {
        // A missing, expired, or invalid cookie is intentionally idempotent.
      }
    }

    if (refreshToken) {
      try {
        const payload =
          await this.refreshJwt.verifyAsync<SessionJwtPayload>(refreshToken);
        if (
          payload.type === 'refresh' &&
          Number.isInteger(payload.sub) &&
          Number.isInteger(payload.sv)
        ) {
          return { userId: payload.sub, sessionVersion: payload.sv };
        }
      } catch {
        // A missing, expired, or invalid cookie is intentionally idempotent.
      }
    }

    return null;
  }

  private formatAuthUser(user: AuthUser) {
    return this.usersService.toSafeUser(user);
  }
}
