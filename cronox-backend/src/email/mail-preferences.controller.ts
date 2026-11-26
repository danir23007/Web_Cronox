import { Controller, Get, Post, Req, UseGuards, Header } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { saveNewsletterPreference } from '../newsletter/newsletter-preference';

@Controller('mail-preferences')
@UseGuards(JwtAuthGuard)
export class MailPreferencesController {
  constructor(private readonly db: PrismaService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async state(@Req() req: Request) {
    const user = req.user as { id: number; email: string };
    const current = await this.db.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true, newsletterSubscribed: true } });
    const suppression = await this.db.mailboxSuppression.findUnique({ where: { email: current.email.trim().toLowerCase() } });
    return { commercialSubscribed: current.newsletterSubscribed && !suppression, commercialSuppressed: Boolean(suppression) };
  }
  @Post('unsubscribe')
  @Header('Cache-Control', 'private, no-store')
  async unsubscribe(@Req() req: Request) {
    const user = req.user as { id: number };
    await this.db.$transaction(async tx => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } });
      const email = current.email.trim().toLowerCase();
      await saveNewsletterPreference(tx, email, false, 'PREFERENCES_UNSUBSCRIBE');
      await tx.mailboxSuppression.upsert({ where: { email }, create: { email, reason: 'UNSUBSCRIBED' }, update: { reason: 'UNSUBSCRIBED' } });
      await tx.user.update({ where: { id: user.id }, data: { newsletterSubscribed: false } });
    });
    return { message: 'Baja comercial registrada. Seguirás recibiendo los correos necesarios de pedidos, seguridad y acceso.' };
  }
}
