import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { CookieOptions, Response } from 'express';
import { CartService } from '../cart/cart.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UsersService, AuthUser } from '../users/users.service';

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
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.usersService.findByEmail(email);

    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.usersService.createUser({
      email,
      passwordHash,
      name: dto.name,
    });

    const tokens = await this.generateTokens(user);

    return { user: this.usersService.toSafeUser(user), tokens };
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

    return { user: this.usersService.toSafeUser(user), tokens };
  }

  async refresh(userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const tokens = await this.generateTokens(user);

    return { user: this.usersService.toSafeUser(user), tokens };
  }

  async getProfile(userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return this.usersService.toSafeUser(user);
  }

  async mergeCartOnLogin(userId: number, cartId?: string) {
    await this.cartService.mergeOnLogin(userId, cartId);
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
}
