// src/auth/auth.service.ts
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
import { randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';
import { CartService, type MergeOnLoginResult } from '../cart/cart.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UsersService, AuthUser } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { NewsletterService } from '../newsletter/newsletter.service';

interface JwtPayload {
  sub: number;
  email: string;
  role: Role | null;
}

type Tokens = {
  accessToken: string;
  refreshToken?: string;
};

@Injectable()
export class AuthService {
  // IMPORTANTE: en local vamos a ignorar NODE_ENV y desactivar Secure
  private readonly isProd = process.env.NODE_ENV === 'production';

  // Marca explícitamente cuando estamos en entorno local
  private readonly isLocalhost =
    process.env.APP_ENV === 'local' ||
    (!this.isProd && (process.env.HOST ?? '').includes('localhost'));

  // si quieres, puedes bajar esto a 8 en dev para que vaya más rápido
  private readonly bcryptSaltRounds = Number(
    process.env.BCRYPT_SALT_ROUNDS ?? '10',
  );

  private readonly logger = new Logger(AuthService.name);

  // Config común de las cookies JWT
  // En local es MUY importante no usar `secure: true` con http://localhost
  private readonly jwtCookieOptions: CookieOptions = {
    httpOnly: true,
    // navegaciones normales funcionan bien con 'lax'
    sameSite: 'lax',
    /**
     * Secure:
     *  - false en localhost / entornos no productivos
     *  - true solo cuando NODE_ENV === 'production' y no es localhost
     */
    secure: this.isProd && !this.isLocalhost,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
  // ⬆⬆⬆ FIN CAMBIO COOKIES ⬆⬆⬆

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject('JWT_REFRESH_SERVICE') private readonly refreshJwt: JwtService,
    private readonly cartService: CartService,
    private readonly prisma: PrismaService,
    private readonly newsletterService: NewsletterService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.usersService.findByEmail(email);

    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const hashedPassword = await this.hashPassword(dto.password);
    const fullName = [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim();
    const user = await this.usersService.createUser({
      email,
      password: hashedPassword,
      name: fullName || undefined,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    const authUser = this.omitPassword(user);

    const subscriptionResult = await this.newsletterService.subscribeIfNeeded(
      user.email,
    );

    if (!subscriptionResult) {
      this.logger.warn(
        `No se pudo suscribir automáticamente al newsletter: ${user.email}`,
      );
    }

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
      throw new UnauthorizedException('Credenciales inválidas');
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

    const authUser = this.omitPassword(user);

    return this.formatAuthUser(authUser);
  }

  async mergeCartOnLogin(userId: number, cartId?: string): Promise<MergeOnLoginResult> {
    return this.cartService.mergeOnLogin(userId, cartId);
  }

  logCartMergeResult(userId: number, result: MergeOnLoginResult) {
    if (!result.merged) {
      this.logger.debug(`No había carrito guest para fusionar en login/register para userId=${userId}`);
      return;
    }

    if (result.incidents.length > 0) {
      this.logger.warn(
        `Carrito guest fusionado con incidencias para userId=${userId}: ${JSON.stringify(result.incidents)}`,
      );
      return;
    }

    this.logger.log(`Carrito guest fusionado correctamente para userId=${userId}`);
  }

  logCartMergeError(userId: number, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `No se pudo fusionar el carrito guest en login/register para userId=${userId}: ${message}`,
    );
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = email?.toLowerCase();
    const user = normalizedEmail
      ? await this.usersService.findByEmail(normalizedEmail)
      : null;

    if (!user) {
      return { ok: true };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    console.log('Password reset token generated for user:', user.email, token);

    return { ok: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const passwordResetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!passwordResetToken) {
      throw new BadRequestException('Token inválido');
    }

    if (passwordResetToken.expiresAt < new Date()) {
      throw new BadRequestException('Token caducado');
    }

    if (passwordResetToken.usedAt) {
      throw new BadRequestException('Token ya usado');
    }

    const hashedPassword = await this.hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: passwordResetToken.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: passwordResetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

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

  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return null;

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
    });

    return { accessToken, refreshToken };
  }

  private async generateAccessToken(user: AuthUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.signAsync(payload);
  }

  private hashPassword(data: string) {
    return bcrypt.hash(data, this.bcryptSaltRounds);
  }

  private formatAuthUser(user: AuthUser) {
    return this.usersService.toSafeUser(user);
  }
}
