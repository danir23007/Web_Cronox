import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateDiscountCode } from '../common/discount-code';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { NewsletterSettingsService } from './newsletter-settings.service';
import { normalizeEmail } from '../common/email';
import { linkNewsletterUser } from './newsletter-user';

export type SubscriptionResult = { status: 'accepted'; httpStatus: number; confirmation?: 'welcome' | 'existing_account' | 'subscribed' };
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

  /** Single opt-in: persist consent and email work atomically before accepting. */
  async subscribe(email: string): Promise<SubscriptionResult> {
    const normalized = normalizeEmail(email);
    const confirmation = await this.scheduleSubscription(normalized);
    return { status: 'accepted', httpStatus: 202, confirmation };
  }

  /** Replacement requests never create consent or reveal whether an account exists. */
  async requestAccess(email: string): Promise<SubscriptionResult> {
    const normalized = normalizeEmail(email);
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + normalized}))`;
      const subscription = await tx.newsletterSubscription.findUnique({ where: { email: normalized } });
      if (!subscription?.subscribedAt) return;
      await this.scheduleAccess(tx, normalized, new Date());
    });
    return { status: 'accepted', httpStatus: 202 };
  }

  private async scheduleAccess(tx: Prisma.TransactionClient, email: string, now: Date) {
    const recent = await tx.newsletterMailJob.findFirst({
      where: { email, kind: 'ACCESS', createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } },
      select: { id: true },
    });
    if (!recent) await tx.newsletterMailJob.create({ data: { email, kind: 'ACCESS' } });
  }

  private async scheduleSubscription(email: string, retries = 2): Promise<NonNullable<SubscriptionResult['confirmation']>> {
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + email}))`;
        const now = new Date();
        const previous = await tx.newsletterSubscription.findUnique({ where: { email } });
        const subscription = await tx.newsletterSubscription.upsert({
          where: { email }, create: { email, subscribedAt: now },
          update: {}, include: { welcomePromoCode: true },
        });
        if (!subscription.subscribedAt) {
          await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: {
            subscribedAt: now, verificationTokenHash: null, verificationExpiresAt: null,
          } });
        }
        const user = await linkNewsletterUser(tx, email, true);
        if (subscription.userId && subscription.userId !== user.id) throw new Error('Newsletter account link conflict: manual review required');
        await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: { userId: user.id } });
        const welcomeJob = await tx.newsletterMailJob.findFirst({
          where: { email, kind: 'WELCOME' }, select: { id: true },
        });
        const eligible = user?.accountState === 'ACTIVE' && ['USER', 'FRIEND'].includes(user.role);
        if (eligible) {
          await this.scheduleAccess(tx, email, now);
          if (previous?.subscribedAt || welcomeJob) return 'existing_account';
        }
        if (welcomeJob && !subscription.welcomeSentAt) return 'subscribed';
        // Historical subscribers keep their existing consent and discounts.
        if (previous?.subscribedAt) {
          await this.scheduleAccess(tx, email, now);
          return 'subscribed';
        }
        if (subscription.welcomeClaimedAt) throw new ServiceUnavailableException({ code: 'NEWSLETTER_UNAVAILABLE' });
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
            if (promo.ownerEmail !== email || !promo.firstOrderOnly) throw new ServiceUnavailableException({ code: 'NEWSLETTER_UNAVAILABLE' });
            await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: { welcomePromoCodeId: promo.id } });
          }
        }
        await tx.newsletterMailJob.create({ data: { email, kind: 'WELCOME' } });
        return eligible ? 'existing_account' : 'welcome';
      });
    } catch (error) {
      if (retries && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        return this.scheduleSubscription(email, retries - 1);
      }
      throw error;
    }
  }
}
