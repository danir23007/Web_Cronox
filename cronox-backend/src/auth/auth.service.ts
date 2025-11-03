import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';
import { EmailService } from '../common/email/email.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotDto } from './dto/forgot.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetDto } from './dto/reset.dto';
import { UsersService, AuthUser } from '../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  [key: string]: unknown;
}

interface RefreshPayload {
  sub: string;
  type?: string;
  [key: string]: unknown;
}

const toPositiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

@Injectable()
export class AuthService {
  private readonly accessSecret =
    process.env.JWT_ACCESS_SECRET ?? 'change_me_access';
  private readonly refreshSecret =
    process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh';
  private readonly accessTtlSec = toPositiveNumber(
    process.env.JWT_ACCESS_EXPIRES,
    15 * 60,
  );
  private readonly refreshTtlSec = toPositiveNumber(
    process.env.JWT_REFRESH_EXPIRES,
    7 * 24 * 60 * 60,
  );
  private readonly bcryptSaltRounds = Number(
    process.env.BCRYPT_SALT_ROUNDS ?? '10',
  );
  private readonly resetTokenTtlMs = 30 * 60 * 1000; // 30 minutos
  private readonly appPublicUrl =
    process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const passwordHash = await this.hashData(dto.password);
    const user = await this.usersService.create({
      email,
      passwordHash,
      name: dto.name,
    });

    const tokens = await this.generateAndPersistTokens(user);

    return {
      user: this.usersService.toSafeUser(user),
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.usersService.findByEmailForAuth(email);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const tokens = await this.generateAndPersistTokens(user);

    return {
      user: this.usersService.toSafeUser(user),
      tokens,
    };
  }

  async refreshTokens(userId: number, refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    const user = await this.validateRefreshToken(userId, refreshToken);

    const tokens = await this.generateTokens(user);
    await this.usersService.setRefreshHash(
      user.id,
      await this.hashData(tokens.refreshToken),
    );

    return tokens;
  }

  async logout(accessToken?: string, refreshToken?: string) {
    if (accessToken) {
      try {
        const payload = await this.verifyAccessToken(accessToken);
        const userId = Number(payload.sub);
        if (Number.isNaN(userId)) {
          throw new UnauthorizedException('Token inválido');
        }
        await this.usersService.clearRefreshHash(userId);
        return;
      } catch (error) {
        // Ignoramos errores para permitir intentar con el refresh token
      }
    }

    if (refreshToken) {
      const payload = await this.verifyRefreshToken(refreshToken);
      const userId = Number(payload.sub);
      if (Number.isNaN(userId)) {
        throw new UnauthorizedException('Token inválido');
      }
      await this.validateRefreshToken(userId, refreshToken);
      await this.usersService.clearRefreshHash(userId);
      return;
    }

    throw new UnauthorizedException('No se proporcionó un token válido');
  }

  async getProfile(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return this.usersService.toSafeUser(user);
  }

  async forgotPassword(dto: ForgotDto) {
    const email = dto.email.toLowerCase();
    const user = await this.usersService.findByEmailForAuth(email);

    if (!user) {
      // Respondemos 200 aunque el usuario no exista para evitar enumeraciones
      return;
    }

    const token = await this.jwtService.signAsync(
      { sub: String(user.id), email: user.email, type: 'reset' },
      {
        secret: this.accessSecret,
        expiresIn: this.resetTokenTtlMs / 1000,
      },
    );

    const hash = await this.hashData(token);
    const expiresAt = new Date(Date.now() + this.resetTokenTtlMs);

    await this.usersService.setResetToken(user.id, hash, expiresAt);

    const normalizedBaseUrl = this.appPublicUrl.replace(/\/$/, '');
    const link = `${normalizedBaseUrl}/reset?token=${token}`;
    await this.emailService.sendPasswordReset(user.email, link);
  }

  async resetPassword(dto: ResetDto) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(dto.token, {
        secret: this.accessSecret,
      });
    } catch (error) {
      throw new BadRequestException('Token inválido o expirado');
    }

    if (!payload?.sub || payload.type !== 'reset') {
      throw new BadRequestException('Token inválido o expirado');
    }

    const userId = Number(payload.sub);
    if (Number.isNaN(userId)) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const user = await this.usersService.findByIdForAuth(userId);
    if (!user || !user.resetTokenHash || !user.resetTokenExp) {
      throw new BadRequestException('Token inválido o expirado');
    }

    if (user.resetTokenExp.getTime() < Date.now()) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const isValidToken = await bcrypt.compare(dto.token, user.resetTokenHash);
    if (!isValidToken) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const newPasswordHash = await this.hashData(dto.newPassword);
    await this.usersService.updatePassword(user.id, newPasswordHash);
    await this.usersService.clearResetToken(user.id);
    await this.usersService.clearRefreshHash(user.id);
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }

    const newPasswordHash = await this.hashData(dto.newPassword);
    await this.usersService.updatePassword(user.id, newPasswordHash);
    await this.usersService.clearRefreshHash(user.id);
  }

  async extractTokensFromRequest(req: Request, dto?: RefreshDto) {
    const authorization = req.headers['authorization'];
    const headerValue = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    const bearerToken = headerValue?.startsWith('Bearer ')
      ? headerValue.slice(7)
      : undefined;

    const refreshFromBody = dto?.refreshToken;

    return {
      accessToken: bearerToken,
      refreshToken: refreshFromBody,
    };
  }

  private async generateAndPersistTokens(user: AuthUser) {
    const tokens = await this.generateTokens(user);
    await this.usersService.setRefreshHash(
      user.id,
      await this.hashData(tokens.refreshToken),
    );
    return tokens;
  }

  private async hashData(data: string) {
    return bcrypt.hash(data, this.bcryptSaltRounds);
  }

  private async validateRefreshToken(
    userId: number,
    refreshToken: string,
  ): Promise<AuthUser> {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const isValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!isValid) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    return user;
  }

  private async generateTokens(user: AuthUser) {
    const payload: JwtPayload = {
      sub: String(user.id),
      email: user.email,
      role: user.role,
    };

    const refreshPayload: RefreshPayload = {
      sub: String(user.id),
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.accessSecret,
        expiresIn: this.accessTtlSec,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtlSec,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.accessSecret,
    });
  }

  private async verifyRefreshToken(token: string): Promise<RefreshPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch (error) {
      throw new UnauthorizedException('Refresh token inválido');
    }
  }
}
