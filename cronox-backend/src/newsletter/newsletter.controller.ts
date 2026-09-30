import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';
import { NewsletterService } from './newsletter.service';

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Get('config')
  @Header('Cache-Control', 'public, max-age=0, must-revalidate')
  getConfiguration() {
    return this.newsletterService.getPublicSettings();
  }

  @Post('subscribe')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async subscribe(@Body() dto: NewsletterSubscribeDto) {
    return this.newsletterService.subscribe(dto.email);
  }

  @Post('request-access')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async requestAccess(@Body() dto: NewsletterSubscribeDto) {
    return this.newsletterService.requestAccess(dto.email);
  }

  @Get('confirm')
  async confirm(
    @Query('token') token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // Old links remain safe but are no longer part of registration.

    // Keep verification tokens out of the subsequent page's Referer header.
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(303, '/');
  }
}
