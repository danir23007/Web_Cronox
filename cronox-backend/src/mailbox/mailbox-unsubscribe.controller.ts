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
    if (!/^[\w-]{1,2000}$/.test(token))
      return res.status(400).send('Enlace no válido.');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
    );
    return res
      .type('html')
      .send(
        `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja de CRONOX</title><h1>Dejar de recibir campañas de CRONOX</h1><form data-mailbox-unsubscribe><button>Confirmar baja</button></form><p role="status"></p><script src="/assets/mailbox-unsubscribe.js" defer></script></html>`,
      );
  }
  @Post(':token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  unsubscribe(@Param('token') token: string) {
    return this.campaigns.unsubscribe(token);
  }
}
