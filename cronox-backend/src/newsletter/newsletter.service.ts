import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateDiscountCode } from '../common/discount-code';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { NewsletterSettingsService } from './newsletter-settings.service';

export type SubscriptionResult = { status: 'accepted'; httpStatus: number };
export type ExistingSubscriptionClaimResult = { status: 'claimed'; code?: string } | { status: 'not_subscribed' };

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly settingsService?: NewsletterSettingsService,
  ) {}

  getPublicSettings() {
    return this.settingsService?.getPublicSettings() ?? {
      version: 1, source: null, variants: null,
      desktop: { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' },
      mobile: { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' },
      desktopAscii: { x: 50, y: 50, scale: 1 }, mobileAscii: { x: 50, y: 50, scale: 1 },
      mediaOpacity: 1, asciiEnabled: true, asciiOpacity: 1,
    };
  }

  /** Inherit existing consent, never account verification or another coupon. */
  async subscribeIfNeeded(email: string): Promise<ExistingSubscriptionClaimResult | null> {
    try {
      return await this.prisma.$transaction(async tx => {
        const normalized = email.trim().toLowerCase();
        const subscription = await tx.newsletterSubscription.findUnique({ where: { email: normalized } });
        const user = await tx.user.findUnique({ where: { email: normalized } });
        if (!subscription?.subscribedAt || !user) return { status: 'not_subscribed' };
        await tx.user.update({ where: { id: user.id }, data: { newsletterSubscribed: true } });
        return { status: 'claimed' };
      });
    } catch {
      this.logger.error('Newsletter consent claim failed');
      return null;
    }
  }

  /** Single opt-in: durable consent + one welcome email, no verification token. */
  async subscribe(email: string): Promise<SubscriptionResult> {
    const normalized = email.trim().toLowerCase();
    const prepared = await this.prepareWelcome(normalized);
    if (!prepared.send) return { status: 'accepted', httpStatus: 202 };
    try {
      await this.emailService.sendNewsletterWelcome(normalized, prepared.code);
    } catch (error) {
      if ((error as { deliveryUnknown?: boolean }).deliveryUnknown) throw this.unavailable();
      await this.prisma.newsletterSubscription.updateMany({
        where: { id: prepared.id, welcomeSentAt: null, welcomeClaimedAt: prepared.claimedAt },
        data: { welcomeClaimedAt: null },
      });
      this.logger.error('Newsletter welcome delivery failed; consent and code preserved');
      throw this.unavailable();
    }
    // Keep the claim if recording acceptance fails; inspect before resending.
    await this.prisma.newsletterSubscription.update({
      where: { id: prepared.id }, data: { welcomeSentAt: new Date(), welcomeClaimedAt: null },
    });
    return { status: 'accepted', httpStatus: 202 };
  }

  private unavailable() {
    return new ServiceUnavailableException({ code: 'NEWSLETTER_UNAVAILABLE',
      message: 'No hemos podido completar el envío del correo de bienvenida. Inténtalo de nuevo en unos minutos.' });
  }

  private async prepareWelcome(email: string, retries = 2): Promise<{
    id: string; send: boolean; code?: string; claimedAt?: Date;
  }> {
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + email}))`;
        const now = new Date();
        const subscription = await tx.newsletterSubscription.upsert({
          where: { email }, create: { email, subscribedAt: now },
          update: {}, include: { welcomePromoCode: true },
        });
        if (!subscription.subscribedAt) {
          await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: {
            subscribedAt: now, verificationTokenHash: null, verificationExpiresAt: null,
          } });
        }
        const user = await tx.user.findUnique({ where: { email } });
        if (user && !user.newsletterSubscribed) {
          await tx.user.update({ where: { id: user.id }, data: { newsletterSubscribed: true } });
        }
        if (subscription.welcomeSentAt) return { id: subscription.id, send: false };
        if (subscription.welcomeClaimedAt) throw this.unavailable();
        let promo = subscription.welcomePromoCode;
        const previousPurchase = await tx.order.findFirst({
          where: { OR: [{ customerEmail: { equals: email, mode: 'insensitive' } }, ...(user ? [{ userId: user.id }] : [])],
            status: { notIn: ['PENDING', 'CANCELLED'] } }, select: { id: true },
        });
        if (!promo && !previousPurchase && !user?.firstOrderDiscountUsed) {
          const legacy = user && await tx.discountCode.findFirst({
            where: { userId: user.id, type: 'FIRST_ORDER' }, orderBy: { createdAt: 'desc' },
          });
          if (!legacy?.used) {
            const code = legacy?.code ?? await generateDiscountCode(tx);
            promo = await tx.promoCode.upsert({
              where: { code }, update: {}, create: {
                code, type: 'PERCENT', value: 10, ownerEmail: email,
                usageLimit: 1, singleUsePerUser: true, firstOrderOnly: true,
              },
            });
            if (promo.ownerEmail !== email || !promo.firstOrderOnly) throw this.unavailable();
            await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: { welcomePromoCodeId: promo.id } });
          }
        }
        await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: { welcomeClaimedAt: now } });
        return { id: subscription.id, send: true, claimedAt: now,
          code: promo && promo.isActive && promo.usageCount === 0 ? promo.code : undefined };
      });
    } catch (error) {
      if (retries && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        return this.prepareWelcome(email, retries - 1);
      }
      throw error;
    }
  }
}
