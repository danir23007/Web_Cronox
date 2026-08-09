import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'crypto';
import { getPublicApiUrl } from '../common/config/environment';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const FIRST_ORDER_DISCOUNT_PERCENT = 10;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export type SubscriptionResult = {
  status: 'accepted';
  httpStatus: number;
};

export type ExistingSubscriptionClaimResult =
  | { status: 'claimed'; code?: string }
  | { status: 'not_subscribed' };

type PendingVerification = {
  token: string;
  tokenHash: string;
};

type GrantedBenefits = {
  code?: string;
  sendDiscount: boolean;
};

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Registration may only claim a subscription that was already confirmed.
   * It never subscribes a newly registered account without consent.
   */
  async subscribeIfNeeded(
    email: string,
  ): Promise<ExistingSubscriptionClaimResult | null> {
    try {
      const normalizedEmail = this.normalizeEmail(email);
      const benefits = await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.newsletterSubscription.findUnique({
          where: { email: normalizedEmail },
        });
        const user = await tx.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (!subscription?.verifiedAt || !user) {
          return null;
        }

        return this.grantVerifiedSubscriptionBenefits(tx, user);
      });

      if (!benefits) {
        return { status: 'not_subscribed' };
      }

      if (benefits.sendDiscount && benefits.code) {
        await this.safeSendDiscountEmail(normalizedEmail, benefits.code);
      }

      return { status: 'claimed', code: benefits.code };
    } catch {
      this.logger.error('Newsletter subscription claim failed');
      return null;
    }
  }

  /**
   * Accept a subscription request without revealing account or subscription
   * state. Unknown addresses are stored separately from User records.
   */
  async subscribe(email: string): Promise<SubscriptionResult> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!this.emailService.isEnabled()) {
      this.logger.warn(
        'Newsletter verification skipped because email delivery is disabled',
      );
      return { status: 'accepted', httpStatus: 202 };
    }

    const pending =
      await this.createOrRefreshPendingVerification(normalizedEmail);
    if (pending) {
      await this.safeSendVerificationEmail(normalizedEmail, pending);
    }

    return { status: 'accepted', httpStatus: 202 };
  }

  async confirm(token: string | undefined): Promise<boolean> {
    if (!token || token.length < 32 || token.length > 512) {
      return false;
    }

    const tokenHash = this.hashToken(token);
    const now = new Date();

    const confirmation = await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.newsletterSubscription.findUnique({
        where: { verificationTokenHash: tokenHash },
      });

      if (
        !subscription ||
        !subscription.verificationExpiresAt ||
        subscription.verifiedAt
      ) {
        return null;
      }

      const claimed = await tx.newsletterSubscription.updateMany({
        where: {
          id: subscription.id,
          verificationTokenHash: tokenHash,
          verifiedAt: null,
          verificationExpiresAt: { gt: now },
        },
        data: {
          verifiedAt: now,
          verificationTokenHash: null,
          verificationExpiresAt: null,
        },
      });

      if (claimed.count !== 1) {
        return null;
      }

      const user = await tx.user.findUnique({
        where: { email: subscription.email },
      });
      if (!user) {
        return {
          email: subscription.email,
          benefits: null as GrantedBenefits | null,
        };
      }

      return {
        email: subscription.email,
        benefits: await this.grantVerifiedSubscriptionBenefits(tx, user),
      };
    });

    if (!confirmation) {
      return false;
    }

    if (confirmation.benefits?.sendDiscount && confirmation.benefits.code) {
      await this.safeSendDiscountEmail(
        confirmation.email,
        confirmation.benefits.code,
      );
    }

    return true;
  }

  private async createOrRefreshPendingVerification(
    email: string,
  ): Promise<PendingVerification | null> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.newsletterSubscription.findUnique({
          where: { email },
        });

        if (existing?.verifiedAt) {
          return null;
        }

        if (existing) {
          await tx.newsletterSubscription.update({
            where: { id: existing.id },
            data: { verificationTokenHash: tokenHash, verificationExpiresAt },
          });
        } else {
          await tx.newsletterSubscription.create({
            data: {
              email,
              verificationTokenHash: tokenHash,
              verificationExpiresAt,
            },
          });
        }

        return { token, tokenHash };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.prisma.newsletterSubscription.update({
          where: { email },
          data: { verificationTokenHash: tokenHash, verificationExpiresAt },
        });
        return { token, tokenHash };
      }

      throw error;
    }
  }

  private async safeSendVerificationEmail(
    email: string,
    pending: PendingVerification,
  ): Promise<void> {
    const confirmationUrl = `${getPublicApiUrl()}/api/newsletter/confirm?token=${encodeURIComponent(pending.token)}`;

    try {
      await this.emailService.sendNewsletterConfirmation(
        email,
        confirmationUrl,
      );
    } catch {
      await this.prisma.newsletterSubscription.updateMany({
        where: {
          email,
          verificationTokenHash: pending.tokenHash,
          verifiedAt: null,
        },
        data: { verificationTokenHash: null, verificationExpiresAt: null },
      });
      this.logger.error('Newsletter verification email delivery failed');
    }
  }

  private async grantVerifiedSubscriptionBenefits(
    tx: Prisma.TransactionClient,
    user: {
      id: number;
      newsletterSubscribed: boolean;
      firstOrderDiscountCode: string | null;
      firstOrderDiscountUsed: boolean;
    },
  ): Promise<GrantedBenefits> {
    const existingDiscount = await this.findFirstOrderDiscount(tx, user.id);
    const existingCode =
      existingDiscount?.code ?? user.firstOrderDiscountCode ?? undefined;
    let code = existingCode;
    let sendDiscount = false;

    if (!user.firstOrderDiscountUsed && !code) {
      code = await this.createFirstOrderDiscount(tx, user.id);
      sendDiscount = true;
    }

    if (!user.newsletterSubscribed || user.firstOrderDiscountCode !== code) {
      await tx.user.update({
        where: { id: user.id },
        data: {
          newsletterSubscribed: true,
          firstOrderDiscountCode: code,
        },
      });
    }

    return { code, sendDiscount };
  }

  private async generateDiscountCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const random = Array.from(
        { length: 6 },
        () => alphabet[randomInt(alphabet.length)],
      ).join('');
      const code = `CRX10-${random}`;
      const found = await tx.discountCode.findUnique({
        where: { code },
        select: { id: true },
      });

      if (!found) {
        return code;
      }
    }

    throw new Error('Unable to allocate a unique first-order discount code');
  }

  private async createFirstOrderDiscount(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<string> {
    const code = await this.generateDiscountCode(tx);

    await tx.discountCode.create({
      data: {
        code,
        type: 'FIRST_ORDER',
        percent: FIRST_ORDER_DISCOUNT_PERCENT,
        used: false,
        userId,
      },
    });

    return code;
  }

  private findFirstOrderDiscount(tx: Prisma.TransactionClient, userId: number) {
    return tx.discountCode.findFirst({
      where: { userId, type: 'FIRST_ORDER' },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async safeSendDiscountEmail(
    email: string,
    code: string,
  ): Promise<void> {
    if (!this.emailService.isEnabled()) {
      return;
    }

    try {
      await this.emailService.sendFirstOrderDiscount(email, code);
    } catch {
      this.logger.error('Newsletter discount email delivery failed');
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
