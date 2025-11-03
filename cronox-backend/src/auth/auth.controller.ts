import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CartService } from '../cart/cart.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotDto } from './dto/forgot.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetDto } from './dto/reset.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshJwtGuard } from './guards/refresh-jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cartService: CartService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Req() req: Request, @Body() dto: LoginDto) {
    const result = await this.authService.login(dto);

    const cookies = (req as Request & {
      cookies?: Record<string, string | undefined>;
    }).cookies;

    await this.cartService.mergeOnLogin(result.user.id, cookies?.cartId);

    return result;
  }

  @Post('refresh')
  @UseGuards(RefreshJwtGuard)
  async refresh(@Req() req: Request) {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    const refreshToken = (req as Request & { refreshToken?: string }).refreshToken;
    return this.authService.refreshTokens(user.id, refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Body() dto: RefreshDto) {
    const tokens = await this.authService.extractTokensFromRequest(req, dto);
    await this.authService.logout(tokens.accessToken, tokens.refreshToken ?? tokens.accessToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: Request) {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    return this.authService.getProfile(user.id);
  }

  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  async forgot(@Body() dto: ForgotDto) {
    await this.authService.forgotPassword(dto);
    return {
      message:
        'Si el email existe recibirás un enlace para restablecer la contraseña',
    };
  }

  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@Body() dto: ResetDto) {
    await this.authService.resetPassword(dto);
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }
    await this.authService.changePassword(user.id, dto);
  }
}
