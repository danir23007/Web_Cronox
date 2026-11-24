import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { getFrontendUrl, getPublicApiUrl } from '../common/config/environment';
import { encrypt } from '../mailbox/mailbox-security';
import { quotaWaiting } from '../email/mail-account-quota';
import { cartInclude, CartWithItems } from './cart.service';
import { abandonmentStart, recordCartActivity } from './cart-abandonment-state';
import { resolveWebPrice } from '../products/web-offer';
import { KeyScreenService } from '../key-screen/key-screen.service';

type Episode = { id: string; cartId: number; userId: number; activityAt: Date; dueAt: Date; attempts: number };
// Exactly the terminal outcomes written by releaseCheckoutSnapshot, after
// provider cancellation/reconciliation. An arbitrary local status is not proof.
const TERMINAL_UNPAID = ['EXPIRED', 'REPLACED', 'PAYMENT_CANCELLED', 'PAYMENT_CREATION_FAILED'];
export const abandonmentWorkerEnabled = () => Boolean(abandonmentStart()) &&
  process.env.CART_ABANDONMENT_ENABLED === 'true' &&
  process.env.BACKGROUND_JOBS_ENABLED !== 'false' && process.env.CRONOX_ROUTE_SMOKE_MODE !== 'true';

/** Same current-price resolver and edition review semantics as the storefront. */
export function purchasableReminderItems(cart: CartWithItems, now = new Date()) {
  const money = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  return cart.items.flatMap(item => {
    const v = item.variant, p = v.product;
    const price = resolveWebPrice(p, v, now).effectivePrice;
    if (!v.isActive || !p.isActive || p.currency !== 'EUR' || v.stockQty <= 0 || item.qty <= 0 ||
        item.lotAtAdd !== p.activeLotId || !Number.isSafeInteger(price) || price < 0) return [];
    const quantity = Math.min(item.qty, v.stockQty);
    const image = p.images[0]?.url || p.imageUrl;
    let imageUrl = '';
    if (image) {
      const url = new URL(image, getFrontendUrl());
      if (url.protocol === 'https:' || url.protocol === 'http:') imageUrl = url.href;
    }
    return [{ name: p.name, variantName: v.size, quantity, imageUrl,
      unitPriceFormatted: money(price), lineTotalFormatted: money(price * quantity) }];
  });
}

@Injectable()
export class CartAbandonmentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CartAbandonmentService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly db: PrismaService, private readonly email: EmailService, private readonly keyScreen: KeyScreenService) {}

  onModuleInit() {
    if (!abandonmentWorkerEnabled()) return;
    this.timer = setInterval(() => void this.tick().catch(() => this.logger.error('CART_ABANDONMENT_SCAN_FAILED')), 10_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Only the explicit visible storefront cart visit calls this, never GET /cart. */
  async activity(userId: number) {
    await this.db.$transaction(async tx => {
      const carts = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Cart" WHERE "userId"=${userId} FOR UPDATE`;
      if (carts[0]) await recordCartActivity(tx, carts[0].id);
    });
    return { recorded: true };
  }

  /** Opaque episode is a locator, never authentication or a saved cart payload. */
  async recover(userId: number, id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return { valid: false };
    return this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<Episode[]>`SELECT j.* FROM "CartAbandonment" j
        JOIN "Cart" c ON c.id=j."cartId" AND c."userId"=j."userId"
        WHERE j.id=${id} AND j."userId"=${userId} AND j.status='SENT'
        AND j."sentAt">clock_timestamp()-interval '30 days' FOR UPDATE OF c`;
      if (!rows.length) return { valid: false };
      const cart = await tx.cart.findUnique({ where: { id: rows[0].cartId }, include: cartInclude });
      if (!cart) return { valid: false };
      // Current cart wins, including a newer selection. No snapshot is restored.
      const items = purchasableReminderItems(cart);
      await recordCartActivity(tx, cart.id);
      return { valid: true, purchasableItems: items, reviewRequired: true };
    });
  }

  async tick() {
    if (this.running || !abandonmentWorkerEnabled() || !this.email.isNewsletterSenderConfigured() || process.env.EMAIL_SMTP_PAUSED === 'true') return;
    this.running = true;
    try {
      await this.db.$executeRaw`UPDATE "CartAbandonment" SET status='UNCERTAIN', "errorCode"='WORKER_INTERRUPTED'
        WHERE status='PROCESSING' AND "claimedAt"<clock_timestamp()-interval '5 minutes'`;
      for (let i = 0; i < 10; i++) {
        // The committed claim survives process death and protects against concurrent workers.
        const rows = await this.db.$queryRaw<Episode[]>`WITH candidate AS (
          SELECT id FROM "CartAbandonment" WHERE status='QUEUED' AND "readyAt"<=clock_timestamp()
            AND "dueAt"<=clock_timestamp() AND "activityAt">=${abandonmentStart()!}
          ORDER BY "readyAt", id FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE "CartAbandonment" j SET status='PROCESSING', "claimedAt"=clock_timestamp(), attempts=attempts+1
          FROM candidate WHERE j.id=candidate.id RETURNING j.*`;
        if (!rows.length) break;
        await this.deliver(rows[0]);
      }
    } finally { this.running = false; }
  }

  private async deliver(job: Episode) {
    let smtpEntered = false;
    const lockDeadline = Date.now() + 18_000;
    try {
      await this.db.$transaction(async tx => {
        // Mutations, merge, checkout admission and fulfillment coordinate on this lock.
        await tx.$queryRaw`SELECT id FROM "Cart" WHERE id=${job.cartId} FOR UPDATE`;
        const current = await tx.$queryRaw<Episode[]>`SELECT * FROM "CartAbandonment" WHERE id=${job.id}
          AND status='PROCESSING' AND "dueAt"<=clock_timestamp() FOR UPDATE`;
        if (!current.length) return;
        const finish = async (status: string, code: string) => {
          await tx.$executeRaw`UPDATE "CartAbandonment" SET status=${status}, "errorCode"=${code} WHERE id=${job.id}`;
        };
        const cart = await tx.cart.findUnique({ where: { id: job.cartId }, include: cartInclude });
        if (!cart || cart.userId !== job.userId || !cart.items.length) return finish('CANCELLED', 'CART_EMPTY_OR_CHANGED_OWNER');
        // Hold consent through SMTP; a concurrent withdrawal linearizes before or after this attempt.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${job.userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: job.userId } });
        if (!user || user.accountState !== 'ACTIVE' || !['USER', 'FRIEND'].includes(user.role) || !user.newsletterSubscribed)
          return finish('CANCELLED', 'NO_CONSENT');
        const email = user.email.trim().toLowerCase();
        const subscription = await tx.newsletterSubscription.findUnique({ where: { email } });
        const suppression = await tx.mailboxSuppression.findUnique({ where: { email } });
        if (!subscription?.subscribedAt || subscription.userId !== user.id || suppression) return finish('CANCELLED', 'NO_CONSENT_OR_SUPPRESSED');
        const snapshots = await tx.checkoutSnapshot.findMany({ where: { OR: [{ cartId: cart.id }, { userId: user.id }] },
          select: { status: true, orderId: true, createdAt: true, updatedAt: true } });
        if (snapshots.some(s => s.orderId && ['ORDER_CREATED', 'REFUNDED', 'DISPUTED'].includes(s.status) && s.updatedAt >= job.activityAt))
          return finish('CANCELLED', 'PURCHASE_COMPLETED');
        // Do not trust local expiry timestamps: only the existing reconciliation worker
        // can make a checkout terminal after querying/cancelling its provider payment.
        if (snapshots.some(s => !TERMINAL_UNPAID.includes(s.status) && !(s.orderId && s.status === 'ORDER_CREATED'))) {
          await tx.$executeRaw`UPDATE "CartAbandonment" SET status='QUEUED', "readyAt"=clock_timestamp()+interval '5 minutes',
            attempts=attempts-1, "errorCode"='PAYMENT_RECONCILIATION_PENDING' WHERE id=${job.id}`;
          return;
        }
        const items = purchasableReminderItems(cart);
        if (!items.length) return finish('CANCELLED', 'NO_PURCHASABLE_ITEMS');
        if (await this.keyScreen.shouldGatePublicHtml()) throw Object.assign(Error('STOREFRONT_CLOSED'), { reminderWait: true });
        const actionUrl = new URL('/cesta', getFrontendUrl());
        actionUrl.searchParams.set('recover', job.id);
        const token = Buffer.from(encrypt(email, 'mailbox-campaign-unsubscribe')).toString('base64url');
        const unsubscribeUrl = new URL('/api/mailbox-unsubscribe/' + token, getPublicApiUrl()).href;
        const prepared = await this.email.prepareAbandonedCart(email, { items, actionUrl: actionUrl.href, unsubscribeUrl, circleLevel: user.circleLevel });
        // Pause may change while rendering. Fail closed before any SMTP call.
        if (!abandonmentWorkerEnabled() || process.env.EMAIL_SMTP_PAUSED === 'true') throw Object.assign(Error('REMINDER_PAUSED'), { reminderWait: true });
        if (Date.now() + 1000 >= lockDeadline) throw Object.assign(Error('REMINDER_PREPARATION_TIMEOUT'), { reminderRetrySafe: true });
        // Verify that the transaction still owns its locks before external I/O.
        await tx.$queryRaw`SELECT id FROM "Cart" WHERE id=${job.cartId} FOR UPDATE`;
        smtpEntered = true;
        const sent = await this.email.sendAbandonedCart(email, prepared, Math.min(lockDeadline, Date.now() + 8000));
        await tx.$executeRaw`UPDATE "CartAbandonment" SET status='SENT', "sentAt"=clock_timestamp(), "messageId"=${sent.messageId}, "errorCode"=NULL WHERE id=${job.id}`;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 25_000 });
    } catch (error) {
      const unknown = smtpEntered && (Boolean((error as any).deliveryUnknown) || !(error as any).reminderRetrySafe && !quotaWaiting(error));
      const wait = quotaWaiting(error) || Boolean((error as any).reminderWait);
      const retry = !unknown && (wait || job.attempts < 3);
      // CAS: activity may already have replaced/cancelled this episode.
      await this.db.$executeRaw`UPDATE "CartAbandonment" SET status=${unknown ? 'UNCERTAIN' : retry ? 'QUEUED' : 'FAILED'},
        "errorCode"=${unknown ? 'SMTP_OUTCOME_UNKNOWN' : retry ? 'RETRY_SAFE' : 'RETRY_EXHAUSTED'},
        "readyAt"=${quotaWaiting(error) ? error.retryAt : new Date(Date.now() + 5 * 60_000)},
        attempts=attempts-${wait ? 1 : 0} WHERE id=${job.id} AND status='PROCESSING'`;
      this.logger.warn(unknown ? 'CART_ABANDONMENT_REQUIRES_REVIEW' : 'CART_ABANDONMENT_RETRY_RECORDED');
    }
  }
}
