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
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async subscribe(@Body() dto: NewsletterSubscribeDto) {
    return this.newsletterService.subscribe(dto.email);
  }

  @Get('confirm')
  async confirm(
    @Query('token') token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const confirmed = await this.newsletterService.confirm(token);

    // Keep verification tokens out of the subsequent page's Referer header.
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    // Render the actual outcome, not an unconditional "confirmed" redirect.
    // No token is echoed into the document, links or subsequent requests.
    const title = confirmed ? 'Suscripción confirmada' : 'No se pudo confirmar la suscripción';
    const message = confirmed
      ? 'Tu dirección de correo ha quedado confirmada. Gracias por unirte a CRONOX.'
      : 'El enlace no es válido, ya se utilizó o ha caducado. Si ya confirmaste tu dirección, no necesitas repetirlo. En caso contrario, vuelve a solicitar un correo y utiliza el enlace más reciente.';
    response.status(confirmed ? 200 : 400).type('html').send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · CRONOX</title></head><body><main><h1>${title}</h1><p>${message}</p><a href="/">Volver a CRONOX</a></main></body></html>`,
    );
  }
}
