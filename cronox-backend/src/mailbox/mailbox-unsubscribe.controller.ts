import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { MailboxCampaignService } from './mailbox-campaign.service';
@Controller('mailbox-unsubscribe')
export class MailboxUnsubscribeController {
  constructor(readonly campaigns: MailboxCampaignService) {}
  // GET only presents confirmation: link scanners cannot unsubscribe a person.
  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  form(@Param('token') token: string, @Res() res: Response) {
    const validToken = /^[\w-]{1,2000}$/.test(token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'",
    );
    return res
      .status(validToken ? 200 : 400)
      .type('html')
      .send(
        `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja de CRONOX</title><link rel="preload" href="/assets/fonts/cormorant-garamond/cormorant-garamond-normal-latin-v21.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/assets/customer-typography.css?v=3"></head><body data-cronox-surface="customer">${validToken ? '<h1>Dejar de recibir campañas de CRONOX</h1><form data-mailbox-unsubscribe><button>Confirmar baja</button></form><p role="status"></p><script src="/assets/mailbox-unsubscribe.js" defer></script>' : '<h1>Enlace no válido.</h1>'}</body></html>`,
      );
  }
  @Post(':token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  unsubscribe(@Param('token') token: string) {
    return this.campaigns.unsubscribe(token);
  }
}
