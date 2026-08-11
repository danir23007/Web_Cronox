import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsConsentDto } from './dto/analytics-consent.dto';
import { IngestAnalyticsEventsDto } from './dto/analytics-event.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('config')
  config() {
    return this.analytics.getClientConfig();
  }

  @Post('consent')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  syncConsent(
    @CurrentUser('id') userId: number,
    @Req() req: Request,
    @Body() dto: AnalyticsConsentDto,
  ) {
    return this.analytics.syncConsent(userId, dto, req);
  }

  @Post('events')
  @HttpCode(202)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  ingest(
    @CurrentUser('id') userId: number,
    @Req() req: Request,
    @Body() dto: IngestAnalyticsEventsDto,
  ) {
    return this.analytics.ingest(userId, req, dto);
  }
}
