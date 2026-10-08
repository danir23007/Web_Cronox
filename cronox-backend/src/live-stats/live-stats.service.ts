import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { getRequiredJwtSecret, isProductionEnvironment } from '../common/config/environment';
import { CART_COOKIE_NAME } from '../common/cookies/cart-cookie';
import type { PresenceDto } from './live-stats.controller';
import { LIVE_STATS_SQL } from './live-stats.sql';
const COOKIE = 'cronox_live_visitor';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class LiveStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly jwt = new JwtService();
  private readonly logger = new Logger(LiveStatsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    if (process.env.BACKGROUND_JOBS_ENABLED === 'false' || process.env.CRONOX_ROUTE_SMOKE_MODE === 'true') return;
    this.timer = setInterval(() => { void this.cleanup().catch(() => this.logger.warn('Presence cleanup failed')); }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    try { await this.prisma.$executeRaw`DELETE FROM "LivePresence" WHERE "seenAt" <= CURRENT_TIMESTAMP - INTERVAL '2 minutes'`; }
    finally { this.cleaning = false; }
  }
  private visitor(req: Request): { hash: string; expires: number } | null {
    const token = req.cookies?.[COOKIE];
    if (typeof token !== 'string' || token.length > 1024) return null;
    try {
      const payload = this.jwt.verify(token, { secret: getRequiredJwtSecret('JWT_ACCESS_SECRET'), algorithms: ['HS256'], audience: 'live-presence' });
      return typeof payload.vid === 'string' && Number.isFinite(payload.exp) ? { hash: hash(payload.vid), expires: payload.exp * 1000 } : null;
    } catch { return null; }
  }
  async signal(req: Request, res: Response, body: PresenceDto) {
    const visitor = this.visitor(req);
    let visitorHash = visitor?.hash || null;
    const user = req.user as { id: number; role: string } | undefined;
    // Ephemeral live presence is separate from consented daily analytics.
    if (body.enabled === false || ['ADMIN', 'SUPERADMIN'].includes(user?.role || '')) {
      if (visitorHash) await this.prisma.$executeRaw`DELETE FROM "LivePresence" WHERE "visitorHash" = ${visitorHash}`;
      // Retain the proof across logout/role changes without counting admins.
      return;
    }
    // Rotate before cookie expiry while we can still remove the old row. A
    // continuously open browser must not briefly become two visitors at 24h.
    if (visitor && visitor.expires - Date.now() <= 120000) {
      await this.prisma.$executeRaw`DELETE FROM "LivePresence" WHERE "visitorHash" = ${visitor.hash}`;
      visitorHash = null;
    }
    if (!visitorHash) {
      const vid = randomUUID();
      const token = this.jwt.sign({ vid }, { secret: getRequiredJwtSecret('JWT_ACCESS_SECRET'), algorithm: 'HS256', audience: 'live-presence', expiresIn: '24h' });
      res.cookie(COOKIE, token, { path: '/api', httpOnly: true, sameSite: 'lax', secure: isProductionEnvironment(), maxAge: 86400_000 });
      visitorHash = hash(vid);
    }
    const sessionId = (req as Request & { authSession?: { sid?: string } }).authSession?.sid || null;
    const userId = user?.id || null;
    const cookie = req.cookies?.[CART_COOKIE_NAME];
    const anonymousId = !userId && typeof cookie === 'string' && /^[\da-f-]{36}$/i.test(cookie) ? cookie : null;
    const productId = body.section === 'product' && body.productId
      ? (await this.prisma.product.findFirst({ where: { id: body.productId, isActive: true }, select: { id: true } }))?.id || null : null;
    await this.prisma.$executeRaw`
      INSERT INTO "LivePresence" ("visitorHash", "userId", "sessionId", "anonymousId", "section", "productId", "seenAt")
      VALUES (${visitorHash}, ${userId}, ${sessionId}, ${anonymousId}, ${body.section}, ${productId}, CURRENT_TIMESTAMP)
      ON CONFLICT ("visitorHash") DO UPDATE SET "userId"=EXCLUDED."userId", "sessionId"=EXCLUDED."sessionId",
      "anonymousId"=EXCLUDED."anonymousId", "section"=EXCLUDED."section", "productId"=EXCLUDED."productId", "seenAt"=CURRENT_TIMESTAMP
      WHERE "LivePresence"."seenAt" <= CURRENT_TIMESTAMP - INTERVAL '5 seconds'
         OR "LivePresence"."userId" IS DISTINCT FROM EXCLUDED."userId"
         OR "LivePresence"."section" IS DISTINCT FROM EXCLUDED."section"
         OR "LivePresence"."productId" IS DISTINCT FROM EXCLUDED."productId"
         OR "LivePresence"."anonymousId" IS DISTINCT FROM EXCLUDED."anonymousId"`;
    await this.cleanup();
  }
  async snapshot() {
    await this.cleanup();
    const rows = await this.prisma.$queryRawUnsafe<{ snapshot: unknown }[]>(LIVE_STATS_SQL);
    return rows[0].snapshot;
  }
}
