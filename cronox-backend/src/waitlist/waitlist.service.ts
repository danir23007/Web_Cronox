import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { isEmail } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RestockDeliveryError } from '../email/restock-delivery.error';
import { getFrontendUrl } from '../common/config/environment';

export const ACTIVE_RESTOCK = [
  'WAITING',
  'QUEUED',
  'PROCESSING',
  'FAILED',
  'UNCERTAIN',
];
const variantInclude = {
  product: {
    include: {
      images: {
        where: { isActive: true, archivedAt: null },
        orderBy: [
          { isPrimary: 'desc' as const },
          { sortOrder: 'asc' as const },
        ],
        take: 1,
      },
    },
  },
};
export const sizeLabel = (size: string) => size.replace('US_', 'US ');
// Default on; an explicit false (or an invalid value) fails closed.
// Use the same effective setting for startup, processing and admin reporting.
export const waitlistWorkerEnabled = () =>
  (process.env.WAITLIST_EMAIL_WORKER_ENABLED ?? 'true').trim().toLowerCase() ===
    'true' && process.env.CRONOX_ROUTE_SMOKE_MODE !== 'true';
export const purchasable = (
  v: {
    stockQty: number;
    isActive: boolean;
    product: { isActive: boolean };
  } | null,
) => Boolean(v && v.stockQty > 0 && v.isActive && v.product.isActive);

@Injectable()
export class WaitlistService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(WaitlistService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  onModuleInit() {
    if (!waitlistWorkerEnabled()) return;
    this.timer = setInterval(
      () =>
        void this.tick().catch(() =>
          this.logger.error('WAITLIST_WORKER_ERROR'),
        ),
      10000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async storeOpen() {
    const gate = await this.prisma.keyScreenSettings.findUnique({
      where: { id: 'global' },
      select: { enabled: true, expiresAt: true },
    });
    return (
      !gate?.enabled ||
      Boolean(gate.expiresAt && gate.expiresAt.getTime() <= Date.now())
    );
  }

  async state(userId: number, variantId: number) {
    const row = await this.prisma.restockRequest.findFirst({
      where: { userId, variantId, status: { in: ACTIVE_RESTOCK } },
      select: { id: true, status: true },
    });
    return { subscription: row };
  }

  async join(userId: number, variantId: number) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize joins against inventory updates; never acquire a lock over SMTP.
      const exists = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { productId: true },
      });
      if (!exists)
        throw new NotFoundException('Esta talla ya no está disponible.');
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${exists.productId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id=${variantId} FOR UPDATE`;
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: { product: true },
      });
      if (!variant?.isActive || !variant.product.isActive)
        throw new NotFoundException('Esta talla no admite avisos.');
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true, accountState: true },
      });
      if (!user || user.accountState !== 'ACTIVE' || !isEmail(user.email))
        throw new BadRequestException(
          'Necesitas una cuenta activa con un correo válido.',
        );
      const existing = await tx.restockRequest.findFirst({
        where: { userId, variantId, status: { in: ACTIVE_RESTOCK } },
      });
      if (existing)
        return {
          subscription: { id: existing.id, status: existing.status },
          existing: true,
        };
      if (purchasable(variant))
        throw new ConflictException(
          'Esta talla ya está disponible. Puedes comprarla.',
        );
      const row = await tx.restockRequest.create({
        data: { userId, variantId },
      });
      return {
        subscription: { id: row.id, status: row.status },
        existing: false,
      };
    });
  }

  async cancel(userId: number, variantId: number) {
    return this.prisma.$transaction(async (tx) => {
      // Same lock as join: cancellation and an immediate new request cannot race.
      await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id=${variantId} FOR UPDATE`;
      const changed = await tx.restockRequest.updateMany({
        where: {
          userId,
          variantId,
          status: { in: ['WAITING', 'QUEUED', 'FAILED', 'UNCERTAIN'] },
        },
        data: { status: 'CANCELLED', readyAt: null },
      });
      if (
        !changed.count &&
        (await tx.restockRequest.count({
          where: { userId, variantId, status: 'PROCESSING' },
        }))
      ) {
        throw new ConflictException(
          'El aviso ya se está enviando; no podemos detenerlo.',
        );
      }
      return { subscription: null };
    });
  }

  async tick() {
    if (this.running || !waitlistWorkerEnabled()) return;
    this.running = true;
    try {
      // Interrupted send is ambiguous, even if the process died before SMTP.
      await this.prisma.restockRequest.updateMany({
        where: {
          status: 'PROCESSING',
          claimedAt: { lt: new Date(Date.now() - 15 * 60000) },
        },
        data: { status: 'UNCERTAIN', errorCode: 'WORKER_INTERRUPTED' },
      });
      if (!this.email.isRestockSenderConfigured()) return;
      if (!(await this.storeOpen())) return;
      for (let i = 0; i < 10; i++) {
        const token = randomUUID();
        const rows = await this.prisma.$queryRaw<{ id: string }[]>`
          WITH candidate AS (
            SELECT r.id FROM "RestockRequest" r
            JOIN "ProductVariant" v ON v.id=r."variantId" JOIN "Product" p ON p.id=v."productId"
            JOIN "User" u ON u.id=r."userId"
            WHERE r.status='QUEUED' AND r."readyAt"<=CURRENT_TIMESTAMP
              AND v.stock>0 AND v."isActive" AND p."isActive" AND u."accountState"='ACTIVE'
            ORDER BY r."readyAt",r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1
          ) UPDATE "RestockRequest" r SET status='PROCESSING', "claimToken"=${token},
            "claimedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP, attempts=attempts+1
            FROM candidate c WHERE r.id=c.id RETURNING r.id`;
        if (!rows.length) break;
        await this.dispatch(rows[0].id, token);
      }
    } finally {
      this.running = false;
    }
  }

  async dispatch(id: string, token: string) {
    const row = await this.prisma.restockRequest.findFirst({
      where: { id, status: 'PROCESSING', claimToken: token },
      include: {
        user: { select: { email: true, accountState: true } },
        variant: { include: variantInclude },
      },
    });
    if (!row) return;
    const update = (data: Prisma.RestockRequestUpdateManyMutationInput) =>
      this.prisma.restockRequest.updateMany({
        where: {
          id,
          claimToken: token,
          status: { in: ['PROCESSING', 'UNCERTAIN'] },
        },
        data,
      });
    if (
      !row.user ||
      row.user.accountState !== 'ACTIVE' ||
      !isEmail(row.user.email)
    ) {
      await update({ status: 'CANCELLED', errorCode: 'RECIPIENT_UNAVAILABLE' });
      return;
    }
    if (!purchasable(row.variant)) {
      await update({
        status: 'WAITING',
        readyAt: null,
        claimToken: null,
        claimedAt: null,
        attempts: { decrement: 1 },
      });
      return;
    }
    if (!this.email.isRestockSenderConfigured() || !(await this.storeOpen())) {
      await update({
        status: 'QUEUED',
        claimToken: null,
        claimedAt: null,
        attempts: { decrement: 1 },
      });
      return;
    }
    const product = row.variant.product;
    const link = new URL(
      `/producto/${encodeURIComponent(product.slug)}`,
      getFrontendUrl(),
    );
    link.searchParams.set('size', row.variant.size);
    const record = product.images[0];
    const variants = record?.variants as Record<
      string,
      { url?: string }
    > | null;
    const candidateImage = variants?.small?.url;
    let imageUrl: string | undefined;
    if (candidateImage) {
      try {
        const url = new URL(candidateImage, getFrontendUrl());
        if (['http:', 'https:'].includes(url.protocol)) imageUrl = url.href;
      } catch {
        /* omit unsupported image */
      }
    }
    try {
      await this.email.sendRestock(row.user.email, {
        product: product.name,
        size: sizeLabel(row.variant.size),
        actionUrl: link.href,
        imageUrl,
      });
    } catch (error) {
      const outcome =
        error instanceof RestockDeliveryError ? error.outcome : 'UNCERTAIN';
      const retry = outcome === 'RETRY' && row.attempts < 3;
      await update({
        status: retry
          ? 'QUEUED'
          : outcome === 'UNCERTAIN'
            ? 'UNCERTAIN'
            : 'FAILED',
        readyAt: retry ? new Date(Date.now() + row.attempts * 5 * 60000) : null,
        errorCode: retry
          ? 'SMTP_RETRY_SAFE'
          : outcome === 'UNCERTAIN'
            ? 'SMTP_OUTCOME_UNKNOWN'
            : 'SMTP_REJECTED',
      });
      this.logger.warn(
        `WAITLIST_${retry ? 'RETRY' : outcome === 'UNCERTAIN' ? 'UNCERTAIN' : 'FAILED'}`,
      );
      return;
    }
    // A database failure after SMTP acceptance must NEVER enter the retry branch.
    await update({
      status: 'ACCEPTED',
      acceptedAt: new Date(),
      errorCode: null,
      readyAt: null,
    });
  }

  async report(query: {
    search?: string;
    size?: string;
    status?: string;
    page: number;
  }) {
    const search = `%${query.search || ''}%`;
    const filter = Prisma.sql`(p.name ILIKE ${search} OR p.slug ILIKE ${search} OR v.sku ILIKE ${search} OR p.id::text=${query.search || ''})
      AND (${query.size || ''}='' OR v.size::text=${query.size || ''})`;
    const grouped = Prisma.sql`
      SELECT v.id, v."productId", v.size::text AS size, v.stock, (v."isActive" AND p."isActive" AND v.stock>0) AS available,
        p.name, p.slug, MAX(r."requestedAt") AS "latestRequest",
        COUNT(DISTINCT r."userId") FILTER (WHERE r.status IN ('WAITING','QUEUED','PROCESSING','FAILED','UNCERTAIN'))::int AS demand,
        COUNT(*) FILTER (WHERE r.status='WAITING')::int AS waiting,
        COUNT(*) FILTER (WHERE r.status='QUEUED')::int AS queued,
        COUNT(*) FILTER (WHERE r.status='PROCESSING')::int AS processing,
        COUNT(*) FILTER (WHERE r.status='ACCEPTED')::int AS accepted,
        COUNT(*) FILTER (WHERE r.status='FAILED')::int AS failed,
        COUNT(*) FILTER (WHERE r.status='UNCERTAIN')::int AS uncertain,
        COUNT(*) FILTER (WHERE r.status='CANCELLED')::int AS cancelled
      FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" JOIN "RestockRequest" r ON r."variantId"=v.id
      WHERE ${filter} GROUP BY v.id,p.id
      HAVING (${query.status || ''}='' OR COUNT(*) FILTER (WHERE r.status=${query.status || ''})>0)`;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.$queryRaw<
        Array<{ id: number; productId: number; [key: string]: unknown }>
      >`SELECT * FROM (${grouped}) g ORDER BY demand DESC, id LIMIT 25 OFFSET ${(query.page - 1) * 25}`,
      this.prisma.$queryRaw<
        { count: number }[]
      >`SELECT COUNT(*)::int AS count FROM (${grouped}) g`,
    ]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      include: { images: variantInclude.product.include.images },
    });
    const people = rows.length
      ? await this.prisma.$queryRaw<{ productId: number; people: number }[]>`
      SELECT v."productId",COUNT(DISTINCT r."userId")::int AS people FROM "RestockRequest" r
      JOIN "ProductVariant" v ON v.id=r."variantId" WHERE v."productId" IN (${Prisma.join(rows.map((r) => r.productId))})
      AND r.status IN ('WAITING','QUEUED','PROCESSING','FAILED','UNCERTAIN') GROUP BY v."productId"`
      : [];
    return {
      rows: rows.map((r) => ({
        ...r,
        image: products.find((p) => p.id === r.productId)?.images[0] || null,
        productPeople:
          people.find((p) => p.productId === r.productId)?.people || 0,
      })),
      page: query.page,
      total: total[0].count,
      pageSize: 25,
      workerEnabled: waitlistWorkerEnabled(),
      senderReady: this.email.isRestockSenderConfigured(),
      storeOpen: await this.storeOpen(),
    };
  }
}
