import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { getFrontendUrl } from '../common/config/environment';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';
import { NewsletterService } from './newsletter.service';

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async subscribe(@Body() dto: NewsletterSubscribeDto) {
    return this.newsletterService.subscribe(dto.email);
  }

  @Get('confirm')
  async confirm(
    @Query('token') token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    await this.newsletterService.confirm(token);

    // Keep verification tokens out of the subsequent page's Referer header.
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(303, `${getFrontendUrl()}/?newsletter=confirmed`);
  }
}
