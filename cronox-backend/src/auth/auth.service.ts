import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';
import { CartService } from '../cart/cart.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UsersService, AuthUser } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

interface JwtPayload {
  sub: number;
  email: string;
  role: Role;
}

interface RefreshPayload {
  sub: number;
  type: 'refresh';
}

type Tokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  private readonly isProd = process.env.NODE_ENV === 'production';
  private readonly bcryptSaltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? '10');
  private readonly accessCookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: this.isProd,
    path: '/',
    maxAge: 15 * 60 * 1000,
  };
  private readonly refreshCookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
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
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.usersService.findByEmail(email);

    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const passwordHash = await this.hashPassword(dto.password);
    const fullName = [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim();
    const user = await this.usersService.createUser({
      email,
      passwordHash,
      name: fullName || undefined,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    const tokens = await this.generateTokens(user);

    return { user: this.formatAuthUser(user), tokens };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const tokens = await this.generateTokens(user);

    return { user: this.formatAuthUser(user), tokens };
  }

  async refresh(userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const tokens = await this.generateTokens(user);

    return { user: this.formatAuthUser(user), tokens };
  }

  async getProfile(userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return this.formatAuthUser(user);
  }

  async mergeCartOnLogin(userId: number, cartId?: string) {
    await this.cartService.mergeOnLogin(userId, cartId);
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

    // TODO: Enviar email al usuario con el enlace de reseteo de contraseña
    // Ejemplo: https://midominio.com/reset-password?token=${token}
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

    const passwordHash = await this.hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: passwordResetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: passwordResetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { ok: true };
  }

  setAuthCookies(res: Response, tokens: Tokens) {
    res.cookie('access_token', tokens.accessToken, this.accessCookieOptions);
    res.cookie('refresh_token', tokens.refreshToken, this.refreshCookieOptions);
  }

  clearAuthCookies(res: Response) {
    res.clearCookie('access_token', { ...this.accessCookieOptions, maxAge: undefined });
    res.clearCookie('refresh_token', { ...this.refreshCookieOptions, maxAge: undefined });
  }

  private async generateTokens(user: AuthUser): Promise<Tokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const refreshPayload: RefreshPayload = {
      sub: user.id,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.refreshJwt.signAsync(refreshPayload),
    ]);

    return { accessToken, refreshToken };
  }

  private hashPassword(data: string) {
    return bcrypt.hash(data, this.bcryptSaltRounds);
  }

  private formatAuthUser(user: AuthUser) {
    const safe = this.usersService.toSafeUser(user);
    return {
      id: safe.id,
      email: safe.email,
      firstName: safe.firstName ?? null,
      lastName: safe.lastName ?? null,
    };
  }
}
