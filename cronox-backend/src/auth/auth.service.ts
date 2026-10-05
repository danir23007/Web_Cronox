import { hashNewPassword } from '../common/password-policy';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { User, UserAccountState } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
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
import { parseClientInfo } from '../analytics/client-info';
import { normalizeEmail } from '../common/email';
import { isAdminPanelRole } from '../common/roles.utils';
import { AuthSessionsService, SessionClaims } from './auth-sessions.service';
import { ACCESS_TOKEN_SECONDS } from './session-policy';
import { serializableTransaction } from '../prisma/serializable-transaction';

const PASSWORD_SETUP_CLAIM_STALE_MS = 10 * 60 * 1000;

type Tokens = {
  idleExpiresAt?: number;
  refreshExpiresAt: Date;
  accessToken: string;
  refreshToken?: string;
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
  };

  constructor(
    private readonly usersService: UsersService,
    private readonly cartService: CartService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly newsletterService: NewsletterService,
    private readonly sessions: AuthSessionsService,
  ) {}

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    const existing = await this.usersService.findByEmail(email);

    if (existing && existing.accountState !== UserAccountState.PRE_REGISTERED) {
      throw new ConflictException('El email ya esta registrado');
    }

    const hashedPassword = await this.hashPassword(dto.password);
    const fullName = [dto.firstName, dto.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const user = existing
      ? await this.usersService.activatePreRegisteredUser(existing.id, {
          password: hashedPassword,
          name: fullName || undefined,
          firstName: dto.firstName,
          lastName: dto.lastName,
        })
      : await this.usersService.createUser({
          email,
          password: hashedPassword,
          name: fullName || undefined,
          firstName: dto.firstName,
          lastName: dto.lastName,
        });
    if (!user) throw new ConflictException('El email ya esta registrado');
    const authUser = this.omitPassword(user);

      // Inherit existing newsletter consent; this does not verify account identity.
    await this.newsletterService.subscribeIfNeeded(user.email);

    const tokens = await this.generateTokens(authUser);

    return {
      user: this.formatAuthUser(authUser),
      token: tokens.accessToken,
      tokens,
    };
  }

  async consumeLaunchLink(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.$transaction(async (tx) => {
      const registration = await tx.preRegistration.findUnique({
        where: { launchTokenHash: tokenHash }, include: { user: true },
      });
      const now = new Date();
      if (!registration || registration.launchTokenUsedAt ||
          !registration.launchTokenExpiresAt || registration.launchTokenExpiresAt <= now ||
          !['USER', 'FRIEND'].includes(registration.user.role)) {
        throw new UnauthorizedException('El enlace ha caducado o ya se ha utilizado. Inicia sesión o restablece tu contraseña.');
      }
      const claimed = await tx.preRegistration.updateMany({
        where: { userId: registration.userId, launchTokenHash: tokenHash,
          launchTokenUsedAt: null, launchTokenExpiresAt: { gt: now } },
        data: { launchTokenUsedAt: now },
      });
      if (claimed.count !== 1) throw new UnauthorizedException('Enlace ya utilizado');
      return tx.user.update({ where: { id: registration.userId },
        data: { accountState: UserAccountState.ACTIVE } });
    });
    const authUser = this.omitPassword(user);
    return { user: this.formatAuthUser(authUser), tokens: await this.generateTokens(authUser) };
  }

  async consumeNewsletterLink(token: string) {
    const invalid = () => new UnauthorizedException('El enlace ha caducado o ya se ha utilizado. Solicita otro enlace o inicia sesión.');
    if (!/^[a-f0-9]{64}$/.test(token)) throw invalid();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.$transaction(async tx => {
      const job = await tx.newsletterMailJob.findUnique({
        where: { tokenHash }, include: { user: true },
      });
      const now = new Date();
      if (!job || !job.user || job.kind !== 'ACCESS' ||
          !['SENT', 'UNCERTAIN'].includes(job.status) || job.tokenUsedAt ||
          !job.tokenExpiresAt || job.tokenExpiresAt <= now ||
          job.user.email.toLowerCase() !== job.email ||
          job.user.accountState !== UserAccountState.ACTIVE ||
          !['USER', 'FRIEND'].includes(job.user.role)) throw invalid();
      const claimed = await tx.newsletterMailJob.updateMany({
        where: { id: job.id, tokenHash, tokenUsedAt: null,
          tokenExpiresAt: { gt: now }, status: { in: ['SENT', 'UNCERTAIN'] } },
        data: { tokenUsedAt: now },
      });
      if (claimed.count !== 1) throw invalid();
      return job.user;
    });
    const authUser = this.omitPassword(user);
    return { user: this.formatAuthUser(authUser), tokens: await this.generateTokens(authUser) };
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

  async recordSuccessfulLogin(userId: number, req: Request): Promise<void> {
    const client = parseClientInfo(req);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.userLoginEvent.create({ data: { userId, ...client } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: now },
      }),
    ]);
  }

  async refresh(userId: number, refreshToken: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const authUser = this.omitPassword(user);
    const session = await this.sessions.verify(refreshToken, 'refresh');
    if (session.userId !== userId) throw new UnauthorizedException();
    const tokens = await this.sessions.rotate(refreshToken);

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

  async hasValidAdminSession(
    accessToken?: string,
    refreshToken?: string,
    res?: Response,
  ): Promise<boolean> {
    try {
      const session = await this.getCurrentSession(
        accessToken,
        refreshToken,
        true,
      );
      if (!session) return false;

      const user = await this.usersService.findById(session.userId);
      const allowed = Boolean(
        user &&
          user.sessionVersion === session.sessionVersion &&
          user.accountState === UserAccountState.ACTIVE &&
          isAdminPanelRole(user.role),
      );
      if (allowed && res && refreshToken) {
        this.setAuthCookies(res, await this.sessions.rotate(refreshToken));
      }
      return allowed;
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      // Invalid credentials are terminal; unavailable authorization is not logout.
      if (res) this.clearAuthCookies(res);
      return false;
    }
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

  /** Logout revokes only the current browser's AuthSession. */
  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    const session = await this.getCurrentSession(accessToken, refreshToken);
    if (!session) {
      return;
    }

    await this.sessions.revoke(session.id);
  }

  async logoutToAnonymousCart(
    anonymousId: string,
    accessToken?: string,
    refreshToken?: string,
  ): Promise<{ cartMoved: boolean }> {
    const session = await this.getCurrentSession(accessToken, refreshToken);
    if (!session) return { cartMoved: false };

    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId: session.userId },
        select: {
          id: true,
          itemsCount: true,
          subtotal: true,
          items: {
            select: { variantId: true, qty: true, priceAtAdd: true },
          },
        },
      });

      if (cart) {
        const otherSessions = await tx.authSession.count({
          where: {
            userId: session.userId,
            id: { not: session.id },
            revokedAt: null,
          },
        });
        const pendingCheckout = otherSessions
          ? await tx.checkoutSnapshot.count({
              where: {
                userId: session.userId,
                cartId: cart.id,
                orderId: null,
                expiresAt: { gt: new Date() },
              },
            })
          : 0;
        if (otherSessions && !pendingCheckout) {
          // Keep the account cart available to other devices while this
          // browser receives an independent guest copy.
          await tx.cart.create({
            data: {
              anonymousId,
              itemsCount: cart.itemsCount,
              subtotal: cart.subtotal,
              items: { create: cart.items },
            },
          });
        } else {
          // An in-flight Stripe checkout keeps the established cart and
          // snapshot handoff so its return can still complete as a guest.
          await tx.checkoutSnapshot.updateMany({
            where: {
              userId: session.userId,
              anonymousId: null,
              cartId: cart.id,
            },
            data: { userId: null, anonymousId },
          });
          await tx.cart.update({
            where: { id: cart.id },
            data: { userId: null, anonymousId },
          });
        }
      }

      await tx.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      return { cartMoved: Boolean(cart) };
    });
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = normalizeEmail(email);
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
    if (
      user &&
      user.accountState !== UserAccountState.PRE_REGISTERED &&
      this.emailService.isEnabled()
    ) {
      void this.createAndSendPasswordReset(user).catch(() => {
        this.logger.error('Password reset delivery task failed');
      });
    }

    return { ok: true };
  }

  private async createAndSendPasswordReset(
    user: Pick<User, 'id' | 'email'>,
  ): Promise<void> {
    await this.createAndSendPasswordLink(user, 'reset');
  }

  async sendInitialPasswordSetupIfNeeded(userId: number): Promise<void> {
    if (!this.emailService.isEnabled()) return;

    const claimed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        password: null,
        passwordSetupEmailSentAt: null,
        OR: [
          { passwordSetupClaimedAt: null },
          {
            passwordSetupClaimedAt: {
              lt: new Date(Date.now() - PASSWORD_SETUP_CLAIM_STALE_MS),
            },
          },
        ],
      },
      data: { passwordSetupClaimedAt: new Date() },
    });
    if (claimed.count !== 1) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, password: true },
    });
    if (!user || user.password !== null) {
      await this.releasePasswordSetupEmailClaim(userId);
      return;
    }

    const sent = await this.createAndSendPasswordLink(user, 'initial-setup');
    if (sent) {
      await this.prisma.user.updateMany({
        where: { id: userId, password: null, passwordSetupEmailSentAt: null },
        data: {
          passwordSetupEmailSentAt: new Date(),
          passwordSetupClaimedAt: null,
        },
      });
      return;
    }

    await this.releasePasswordSetupEmailClaim(userId);
  }

  private async createAndSendPasswordLink(
    user: Pick<User, 'id' | 'email'>,
    purpose: 'reset' | 'initial-setup',
  ): Promise<boolean> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashResetToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

    const persisted = await serializableTransaction(this.prisma, async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id }, select: { email: true } });
      // A reset request can be queued before an email change and persisted after
      // it. Serialize the check with profile changes, without sending inside a retry.
      if (!current || normalizeEmail(current.email) !== normalizeEmail(user.email)) return false;
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
      return true;
    });
    if (!persisted) return false;

    const resetUrl = `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      if (purpose === 'initial-setup') {
        await this.emailService.sendInitialPasswordSetup(user.email, resetUrl);
      } else {
        await this.emailService.sendPasswordReset(user.email, resetUrl);
      }
      return true;
    } catch {
      // Do not leave an actionable token if it could not be delivered.
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, token: tokenHash, usedAt: null },
        data: { usedAt: new Date() },
      });
      this.logger.error(
        purpose === 'initial-setup'
          ? 'Initial password setup email delivery failed'
          : 'Password reset email delivery failed',
      );
      return false;
    }
  }

  private async releasePasswordSetupEmailClaim(userId: number): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, password: null, passwordSetupEmailSentAt: null },
      data: { passwordSetupClaimedAt: null },
    });
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.usersService.findById(userId);
    if (!user || user.accountState !== UserAccountState.ACTIVE) throw new UnauthorizedException();
    if (user.password && (!dto.currentPassword || !await bcrypt.compare(dto.currentPassword, user.password))) {
      throw new BadRequestException('La contrase\u00f1a actual no es correcta.');
    }
    const password = await this.hashPassword(dto.newPassword);
    const updated = await this.prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({
        where: { id: userId, password: user.password, sessionVersion: user.sessionVersion, accountState: UserAccountState.ACTIVE },
        data: { password, sessionVersion: { increment: 1 }, passwordSetupClaimedAt: null },
      });
      if (changed.count !== 1) throw new ConflictException('La cuenta cambi\u00f3. Recarga e int\u00e9ntalo de nuevo.');
      await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
    return { hasPassword: true, tokens: await this.generateTokens(this.omitPassword(updated)) };
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
          passwordSetupClaimedAt: null,
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
    res.setHeader('Cache-Control', 'no-store');
    if (tokens.idleExpiresAt)
      res.setHeader('X-Session-Idle-Expires', String(tokens.idleExpiresAt));
    res.cookie('jwt', tokens.accessToken, {
      ...this.jwtCookieOptions,
      maxAge: ACCESS_TOKEN_SECONDS * 1000,
    });
    if (tokens.refreshToken) {
      res.cookie('refresh_token', tokens.refreshToken, {
        ...this.jwtCookieOptions,
        expires: tokens.refreshExpiresAt,
      });
    }
  }

  clearAuthCookies(res: Response) {
    res.clearCookie('jwt', this.jwtCookieOptions);
    res.clearCookie('refresh_token', this.jwtCookieOptions);
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
    const normalizedEmail = normalizeEmail(email);
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });

    const isValid = await bcrypt.compare(
      password,
      user?.password ?? this.dummyPasswordHash,
    );
    if (!user || !isValid || user.accountState !== UserAccountState.ACTIVE)
      return null;

    return this.omitPassword(user);
  }

  private omitPassword(user: User): AuthUser {
    const { password: _password, ...rest } = user;
    return { ...rest, hasPassword: Boolean(_password) };
  }

  private async generateTokens(user: AuthUser): Promise<Tokens> {
    return this.sessions.create(user);
  }

  reportActivity(payload: SessionClaims) {
    return this.sessions.touch(payload);
  }

  private hashPassword(data: string) {
    return hashNewPassword(data);
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async getCurrentSession(
    accessToken?: string,
    refreshToken?: string,
    throwOnInvalid = false,
  ) {
    let validationError: unknown;
    if (accessToken) {
      try {
        return await this.sessions.verify(accessToken, 'access');
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
        validationError = error;
        // A missing, expired, or invalid cookie is intentionally idempotent.
      }
    }

    if (refreshToken) {
      try {
        return await this.sessions.verify(refreshToken, 'refresh');
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
        validationError = error;
        // A missing, expired, or invalid cookie is intentionally idempotent.
      }
    }

    if (throwOnInvalid && validationError) {
      throw validationError instanceof Error
        ? validationError
        : new UnauthorizedException('Inicia sesión de nuevo.');
    }
    return null;
  }

  private formatAuthUser(user: AuthUser) {
    return this.usersService.toSafeUser(user);
  }
}
