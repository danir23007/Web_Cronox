import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';
import { NewsletterService } from './newsletter.service';

@Controller('api/newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  async subscribe(@Body() dto: NewsletterSubscribeDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.newsletterService.subscribe(dto.email);
    res.status(result.httpStatus ?? 201);
    return { status: result.status };
  }
}
