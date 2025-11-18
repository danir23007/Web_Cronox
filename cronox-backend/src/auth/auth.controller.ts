import {
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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RegisterDto,
  ) {
    const result = await this.authService.register(dto);
    const cookies = (req as Request & { cookies?: Record<string, string | undefined> }).cookies;
    await this.authService.mergeCartOnLogin(result.user.id, cookies?.cartId);
    this.authService.setAuthCookies(res, result.tokens);
    return { user: result.user };
  }

  @Post('login')
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    const result = await this.authService.login(dto);
    const cookies = (req as Request & { cookies?: Record<string, string | undefined> }).cookies;
    await this.authService.mergeCartOnLogin(result.user.id, cookies?.cartId);
    this.authService.setAuthCookies(res, result.tokens);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAuthCookies(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser('id') userId: number) {
    return this.authService.getProfile(userId);
  }

  @Post('refresh')
  @UseGuards(RefreshJwtGuard)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    const result = await this.authService.refresh(userId);
    this.authService.setAuthCookies(res, result.tokens);
    return { user: result.user };
  }
}
