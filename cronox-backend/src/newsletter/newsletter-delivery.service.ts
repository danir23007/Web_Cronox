import { UserNumberingGate } from '../users/user-numbering-gate.module';
import { generateInitialPassword, hashNewPassword } from '../common/password-policy';
import { Injectable, Optional, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { quotaWaiting } from '../email/mail-account-quota';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getFrontendUrl } from '../common/config/environment';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const STALE_MS = 15 * 60_000;
const TOKEN_MS = 20 * 60_000;
const MAX_ATTEMPTS = 3;

export const newsletterWorkerEnabled = () =>
  process.env.BACKGROUND_JOBS_ENABLED !== 'false' &&
  process.env.NEWSLETTER_EMAIL_WORKER_ENABLED !== 'false' &&
  process.env.CRONOX_ROUTE_SMOKE_MODE !== 'true';

@Injectable()
export class NewsletterDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsletterDeliveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private gatePending = false;

  constructor(private readonly prisma: PrismaService, private readonly email: EmailService, @Optional() private readonly numbering?: UserNumberingGate) {}

  onModuleInit() {
    if (!newsletterWorkerEnabled()) return;
    this.timer = setInterval(() => void this.tick().catch(() => this.logger.error('NEWSLETTER_WORKER_ERROR')), 10_000);
    this.timer.unref();
    void this.tick().catch(() => this.logger.error('NEWSLETTER_WORKER_START_ERROR'));
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.gatePending) return;
    this.gatePending = true;
    try { return await (this.numbering ? this.numbering.shared(() => this.tickLocked()) : this.tickLocked()); }
    finally { this.gatePending = false; }
  }
  async tickLocked() {
    if (this.running || !newsletterWorkerEnabled()) return;
    this.running = true;
    try {
      // A restarted process cannot know whether SMTP accepted an interrupted send.
      await this.prisma.newsletterMailJob.updateMany({
        where: { status: 'PROCESSING', claimedAt: { lt: new Date(Date.now() - STALE_MS) } },
        data: { status: 'UNCERTAIN', errorCode: 'WORKER_INTERRUPTED' },
      });
      if (!this.email.isNewsletterSenderConfigured()) return;
      for (let index = 0; index < 10; index++) {
        const claim = randomUUID();
        const rows = await this.prisma.$queryRaw<{ id: string }[]>`
          WITH candidate AS (
            SELECT id FROM "NewsletterMailJob"
            WHERE status='QUEUED' AND "readyAt"<=CURRENT_TIMESTAMP
            ORDER BY "readyAt",id FOR UPDATE SKIP LOCKED LIMIT 1
          ) UPDATE "NewsletterMailJob" j SET status='PROCESSING',
            "claimToken"=${claim}, "claimedAt"=CURRENT_TIMESTAMP,
            "updatedAt"=CURRENT_TIMESTAMP, attempts=attempts+1
          FROM candidate c WHERE j.id=c.id RETURNING j.id`;
        if (!rows.length) break;
        await this.dispatch(rows[0].id, claim);
      }
    } finally { this.running = false; }
  }

  async dispatch(id: string, claim: string) {
    const job = await this.prisma.newsletterMailJob.findFirst({
      where: { id, status: 'PROCESSING', claimToken: claim },
    });
    if (!job) return;
    const where = { id, status: 'PROCESSING', claimToken: claim };
    let initialPassword: string | undefined;
    let initialHash: string | undefined;
    let initialUserId: number | undefined;
    let rawToken: string | undefined;
    let actionUrl: string | undefined;
    let welcomeCode: string | undefined;
    if (job.kind === 'WELCOME') {
      const subscription = await this.prisma.newsletterSubscription.findUnique({
        where: { email: job.email }, include: { welcomePromoCode: true },
      });
      if (!subscription?.subscribedAt) {
        await this.prisma.newsletterMailJob.updateMany({ where, data: { status: 'FAILED', errorCode: 'CONSENT_MISSING' } });
        return;
      }
      if (subscription.welcomeSentAt) {
        await this.prisma.newsletterMailJob.updateMany({ where, data: { status: 'SENT', sentAt: subscription.welcomeSentAt } });
        return;
      }
      const promo = subscription.welcomePromoCode;
      welcomeCode = promo?.isActive && promo.usageCount === 0 ? promo.code : undefined;
    } else if (job.kind === 'ACCESS') {
      const matches = await this.prisma.user.findMany({
        where: { email: { equals: job.email, mode: 'insensitive' } },
        select: { id: true, email: true, role: true, accountState: true, password: true },
        take: 2,
      });
      const user = matches.length === 1 ? matches[0] : null;
      const eligible = user && user.accountState === 'ACTIVE' && ['USER', 'FRIEND'].includes(user.role) &&
        user.email.toLowerCase() === job.email;
      if (eligible) {
        rawToken = randomBytes(32).toString('hex');
        const saved = await this.prisma.$transaction(async tx => {
          // Claim the token once, including duplicate dispatch calls with the same lease.
          const claimed = await tx.newsletterMailJob.updateMany({ where: { ...where, tokenHash: null }, data: {
            userId: user.id, tokenHash: createHash('sha256').update(rawToken!).digest('hex'),
            tokenExpiresAt: new Date(Date.now() + TOKEN_MS),
          } });
          if (claimed.count !== 1) return false;
          // Serialize generation across different jobs for this account, then re-read.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`newsletter-password:${user.id}`}))`;
          const current = await tx.user.findUnique({ where: { id: user.id },
            select: { password: true, email: true, accountState: true, role: true } });
          if (!current || current.email.toLowerCase() !== job.email || current.accountState !== 'ACTIVE' || !['USER', 'FRIEND'].includes(current.role)) {
            await tx.newsletterMailJob.updateMany({ where, data: { status: 'FAILED', errorCode: 'RECIPIENT_UNAVAILABLE', tokenHash: null, tokenExpiresAt: null, userId: null } });
            return false;
          }
          if (current.password === null) {
            const candidate = generateInitialPassword();
            const hash = await hashNewPassword(candidate);
            const changed = await tx.user.updateMany({
              where: { id: user.id, password: null, email: user.email, accountState: 'ACTIVE', role: { in: ['USER', 'FRIEND'] } },
              data: { password: hash },
            });
            if (changed.count === 1) {
              initialPassword = candidate; initialHash = hash; initialUserId = user.id;
            }
          }
          return true;
        });
        if (!saved) return;
        actionUrl = new URL(`/newsletter-access.html#${rawToken}`, getFrontendUrl()).href;
      } else {
        actionUrl = new URL(matches.length ? '/index.html?login=1' : '/index.html?register=1', getFrontendUrl()).href;
      }
    } else {
      await this.prisma.newsletterMailJob.updateMany({ where, data: { status: 'FAILED', errorCode: 'INVALID_KIND' } });
      return;
    }
    try {
      if (job.kind === 'WELCOME') await this.email.sendNewsletterWelcome(job.email, welcomeCode);
      else await this.email.sendNewsletterAccess(job.email, actionUrl!, Boolean(rawToken), initialPassword);
    } catch (error) {
      const uncertain = Boolean((error as { deliveryUnknown?: boolean }).deliveryUnknown);
      if (!uncertain && initialHash && initialUserId) {
        // Only a definite rejection permits rollback; never overwrite a later password change.
        await this.prisma.user.updateMany({ where: { id: initialUserId, password: initialHash }, data: { password: null } });
      }
      initialPassword = undefined;
      const waiting = quotaWaiting(error);
      const retry = waiting || (!uncertain && job.attempts < MAX_ATTEMPTS);
      await this.prisma.newsletterMailJob.updateMany({ where, data: {
        status: retry ? 'QUEUED' : uncertain ? 'UNCERTAIN' : 'FAILED',
        errorCode: waiting ? 'EMAIL_QUOTA_WAITING' : retry ? 'RETRY_SAFE' : uncertain ? 'SMTP_OUTCOME_UNKNOWN' : 'SMTP_REJECTED',
        readyAt: waiting ? error.retryAt : retry ? new Date(Date.now() + job.attempts * 5 * 60_000) : job.readyAt,
        ...(waiting ? { attempts: { decrement: 1 } } : {}),
        claimToken: null, claimedAt: null,
        ...(!uncertain ? { tokenHash: null, tokenExpiresAt: null, userId: null } : {}),
      } });
      this.logger.warn(`NEWSLETTER_DELIVERY_${retry ? 'RETRY' : uncertain ? 'UNCERTAIN' : 'FAILED'}`);
      return;
    }
    // A failure after SMTP acceptance must remain ambiguous, never retried.
    await this.prisma.$transaction(async tx => {
      const updated = await tx.newsletterMailJob.updateMany({ where, data: {
        status: 'SENT', sentAt: new Date(), claimToken: null, claimedAt: null, errorCode: null,
      } });
      if (updated.count !== 1) throw new Error('NEWSLETTER_JOB_CLAIM_LOST');
      if (job.kind === 'WELCOME') await tx.newsletterSubscription.updateMany({
        where: { email: job.email, welcomeSentAt: null },
        data: { welcomeSentAt: new Date(), welcomeClaimedAt: null },
      });
    });
  }
}
