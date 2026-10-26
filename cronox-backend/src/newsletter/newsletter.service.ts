import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { NewsletterSettingsService } from './newsletter-settings.service';
import { normalizeEmail } from '../common/email';

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

  /** Footer/popup first step is read-only, including for historical subscribers. */
  async startRegistration(email: string) {
    const normalized = normalizeEmail(email);
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' } }, select: { id: true },
    });
    return { status: user ? 'authentication_required' : 'registration_required' };
  }

  /** Existing accounts opt in only after authentication of the same address. */
  async completeRegistration(userId: number, email: string) {
    const normalized = normalizeEmail(email);
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + normalized}))`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || normalizeEmail(user.email) !== normalized || user.accountState !== 'ACTIVE' || !['USER', 'FRIEND'].includes(user.role)) {
        throw new ForbiddenException('Inicia sesión con el correo que quieres suscribir.');
      }
      const subscription = await tx.newsletterSubscription.findUnique({ where: { email: normalized } });
      if (subscription?.userId && subscription.userId !== user.id) {
        throw new ServiceUnavailableException({ code: 'NEWSLETTER_ACCOUNT_LINK_CONFLICT' });
      }
      await tx.newsletterSubscription.upsert({
        where: { email: normalized },
        create: { email: normalized, userId, subscribedAt: new Date() },
        update: { userId, subscribedAt: subscription?.subscribedAt ?? new Date() },
      });
      await tx.user.update({ where: { id: userId }, data: { newsletterSubscribed: true } });
      // The account lifecycle already owns welcome delivery and its personal
      // code. Signing in to subscribe must not create another of either.
    });
    return { status: 'subscribed' };
  }

  /** Checkout opt-in retains its existing independent purchase flow. */
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
        const subscription = await tx.newsletterSubscription.upsert({
          where: { email }, create: { email, subscribedAt: now },
          update: {},
        });
        if (!subscription.subscribedAt) {
          await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: {
            subscribedAt: now, verificationTokenHash: null, verificationExpiresAt: null,
          } });
        }
        const matches = await tx.$queryRaw<Pick<User, 'id' | 'email' | 'role' | 'accountState' | 'newsletterSubscribed'>[]>`SELECT id, email, role, "accountState", "newsletterSubscribed" FROM "User" WHERE lower(btrim(email)) = ${email} LIMIT 2`;
        if (matches.length > 1) throw new ServiceUnavailableException({ code: 'NEWSLETTER_ACCOUNT_AMBIGUOUS' });
        const user = matches[0];
        if (subscription.userId && subscription.userId !== user?.id) throw new ServiceUnavailableException({ code: 'NEWSLETTER_ACCOUNT_LINK_CONFLICT' });
        // Checkout can record consent without making registration a purchase requirement.
        if (!user) return 'subscribed';
        if (!user.newsletterSubscribed) await tx.user.update({ where: { id: user.id }, data: { newsletterSubscribed: true } });
        await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: { userId: user.id } });
        const welcomeJob = await tx.newsletterMailJob.findFirst({ where: { email, kind: 'WELCOME' }, select: { id: true } });
        // Preserve existing access delivery and its cooldown, but never add it
        // beside a pending account welcome. This response grants no session.
        const eligible = user?.accountState === 'ACTIVE' && ['USER', 'FRIEND'].includes(user.role);
        if (eligible && (!welcomeJob || subscription.welcomeSentAt)) {
          await this.scheduleAccess(tx, email, now);
        }
        return 'existing_account';
      });
    } catch (error) {
      if (retries && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        return this.scheduleSubscription(email, retries - 1);
      }
      throw error;
    }
  }
}
