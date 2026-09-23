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
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CsrfTokenRequest } from '../common/guards/csrf-protection.guard';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshJwtGuard } from './guards/refresh-jwt.guard';
import { LaunchLoginDto } from './dto/launch-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { randomUUID } from 'node:crypto';
import { SessionClaims } from './auth-sessions.service';
import {
  CART_COOKIE_NAME,
  getCartCookieOptions,
} from '../common/cookies/cart-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RegisterDto,
  ) {
    const result = await this.authService.register(dto);

    const cookies = (
      req as Request & { cookies?: Record<string, string | undefined> }
    ).cookies;
    let cartMerge: Awaited<ReturnType<AuthService['mergeCartOnLogin']>> = {
      merged: false,
      incidents: [],
    };

    try {
      cartMerge = await this.authService.mergeCartOnLogin(
        result.user.id,
        cookies?.cartId,
      );
      this.authService.logCartMergeResult(result.user.id, cartMerge);
      if (cartMerge.merged) {
        this.authService.clearMergedAnonymousCartCookie(res);
      }
    } catch (error) {
      this.authService.logCartMergeError(result.user.id, error);
    }

    this.authService.setAuthCookies(res, result.tokens);

    return { user: { ...result.user, cartMerge }, cartMerge };
  }

  @Post('launch-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async launchLogin(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LaunchLoginDto,
  ) {
    const result = await this.authService.consumeLaunchLink(dto.token);
    res.setHeader('Cache-Control', 'no-store');
    this.authService.setAuthCookies(res, result.tokens);
    return { user: result.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    const result = await this.authService.login(dto);
    await this.authService.recordSuccessfulLogin?.(result.user.id, req);

    const cookies = (
      req as Request & { cookies?: Record<string, string | undefined> }
    ).cookies;
    let cartMerge: Awaited<ReturnType<AuthService['mergeCartOnLogin']>> = {
      merged: false,
      incidents: [],
    };

    try {
      cartMerge = await this.authService.mergeCartOnLogin(
        result.user.id,
        cookies?.cartId,
      );
      this.authService.logCartMergeResult(result.user.id, cartMerge);
      if (cartMerge.merged) {
        this.authService.clearMergedAnonymousCartCookie(res);
      }
    } catch (error) {
      this.authService.logCartMergeError(result.user.id, error);
    }

    this.authService.setAuthCookies(res, result.tokens);

    return { user: { ...result.user, cartMerge }, cartMerge };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = (
      req as Request & { cookies?: Record<string, string | undefined> }
    ).cookies;

    const anonymousId = randomUUID();
    try {
      const result = await this.authService.logoutToAnonymousCart(
        anonymousId,
        cookies?.jwt,
        cookies?.refresh_token,
      );
      if (result.cartMoved) {
        res.cookie(CART_COOKIE_NAME, anonymousId, getCartCookieOptions());
      }
    } finally {
      this.authService.clearAuthCookies(res);
    }
  }

  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { ok: true, csrfToken: (req as CsrfTokenRequest).csrfToken };
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
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = (req as any).user?.id;

    if (!userId) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    try {
      const result = await this.authService.refresh(
        userId,
        (req as Request & { refreshToken: string }).refreshToken,
      );
      this.authService.setAuthCookies(res, result.tokens);
      return { user: result.user };
    } catch (error) {
      if (error instanceof UnauthorizedException)
        this.authService.clearAuthCookies(res);
      throw error;
    }
  }

  @Post('activity')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  activity(@Req() req: Request) {
    return this.authService.reportActivity(
      (req as Request & { authSession: SessionClaims }).authSession,
    );
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { ok: true };
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() body: ResetPasswordDto) {
    const { token, password } = body;

    if (!token || !password) {
      throw new BadRequestException(
        'Token y nueva contraseña son obligatorios',
      );
    }

    await this.authService.resetPassword(token, password);
    return { ok: true };
  }
}
