// src/auth/auth.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshJwtGuard } from './guards/refresh-jwt.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RegisterDto,
  ) {
    const result = await this.authService.register(dto);

    const cookies = (req as Request & { cookies?: Record<string, string | undefined> }).cookies;
    try {
      await this.authService.mergeCartOnLogin(result.user.id, cookies?.cartId);
    } catch (error) {
      this.authService.logCartMergeError(result.user.id, error);
    }

    this.authService.setAuthCookies(res, result.tokens);

    return { user: result.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    const result = await this.authService.login(dto);

    const cookies = (req as Request & { cookies?: Record<string, string | undefined> }).cookies;
    try {
      await this.authService.mergeCartOnLogin(result.user.id, cookies?.cartId);
    } catch (error) {
      this.authService.logCartMergeError(result.user.id, error);
    }

    this.authService.setAuthCookies(res, result.tokens);

    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAuthCookies(res);
  }

  /**
   * Nuevo alias: /api/auth/me
   * Lo usa el front para saber si hay sesión activa.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser('id') userId: number) {
    return this.authService.getProfile(userId);
  }

  /**
   * Ruta antigua /api/auth/profile (la dejo por compatibilidad,
   * pero internamente hace lo mismo que /auth/me)
   */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async profile(@CurrentUser('id') userId: number) {
    return this.authService.getProfile(userId);
  }

  @Post('refresh')
  @UseGuards(RefreshJwtGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = (req as any).user?.id;

    if (!userId) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const result = await this.authService.refresh(userId);
    this.authService.setAuthCookies(res, result.tokens);

    return { user: result.user };
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { ok: true };
  }

  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    const { token, password } = body;

    if (!token || !password) {
      throw new BadRequestException('Token y nueva contraseña son obligatorios');
    }

    await this.authService.resetPassword(token, password);
    return { ok: true };
  }
}
