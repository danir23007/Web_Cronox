import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { LiveStatsService } from './live-stats.service';

export class PresenceDto {
  @IsIn(['home', 'store', 'product', 'cart', 'checkout', 'other']) section: string;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) productId?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
@Controller()
export class LiveStatsController {
  constructor(private readonly stats: LiveStatsService) {}
  @Post('live-stats/presence')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(OptionalJwtAuthGuard)
  async presence(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: PresenceDto) {
    await this.stats.signal(req, res, body);
  }
  @Get('admin/live-stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  snapshot(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.stats.snapshot();
  }
}
