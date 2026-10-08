import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { isProductionEnvironment } from '../common/config/environment';
import { PrismaService } from '../prisma/prisma.service';
import { hasAnalyticsConsent } from './analytics-consent';
import {
  cleanPageForPath,
  LEGACY_PUBLIC_REDIRECTS,
  UNGATED_PUBLIC_PATHS,
} from '../common/routing/public-pages';
import {
  madridDate,
  nextDate,
  validateRange,
} from '../admin/finance/financial-calculations';

export const isPublicVisitPath = (path: string) =>
  !path.includes('?') &&
  !path.includes('#') &&
  (Boolean(cleanPageForPath(path)) ||
    LEGACY_PUBLIC_REDIRECTS.has(path) ||
    UNGATED_PUBLIC_PATHS.has(path) ||
    ['/launch.html', '/producto.html'].includes(path));

// Notification exclusion only; never changes the historical counting rules.
export const isAutomatedPushVisit = (req: Request) =>
  /bot\b|crawler|spider|headlesschrome|playwright|selenium|uptimerobot|monitoring/i.test(
    req.get?.('user-agent') || '',
  );

type VerifiedVisitorUser = { id: number; role?: string | null };
type BrowserDay = {
  id: string;
  visited: boolean;
  linked: boolean;
  adminExcluded: boolean;
};

@Injectable()
export class VisitorHistoryService {
  constructor(private readonly db: PrismaService) {}

  revokeConsent(req: Request, res: Response) {
    if (hasAnalyticsConsent(req))
      throw new BadRequestException('CONSENT_STILL_ACTIVE');
    // Privacy cleanup must also work with expired/unavailable authentication.
    res.clearCookie('cronox_daily_visitor', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProductionEnvironment(),
      path: '/api',
    });
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  async session(req: Request, res: Response, now = new Date(), prepare = true) {
    const day = madridDate(now);
    let browserReady = false;
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: isProductionEnvironment(),
      path: '/api',
    };
    if (!hasAnalyticsConsent(req)) {
      res.clearCookie('cronox_daily_visitor', options);
    } else {
      browserReady = Boolean(await this.browser(req, now));
      if (!browserReady && prepare) {
        const token = randomBytes(32).toString('hex');
        await this.db
          .$executeRaw`INSERT INTO "DailyVisitorBrowser" (id, day, "proofHash") VALUES (${randomUUID()}, ${day}::date, ${this.hash(token)})`;
        // Expire at the next Madrid midnight, including 23/25-hour DST days.
        let boundary = new Date(now.getTime() + 3600000);
        while (madridDate(boundary) === day)
          boundary = new Date(boundary.getTime() + 3600000);
        let low = now.getTime(),
          high = boundary.getTime();
        while (high - low > 1) {
          const middle = Math.floor((low + high) / 2);
          if (madridDate(new Date(middle)) === day) low = middle;
          else high = middle;
        }
        res.cookie('cronox_daily_visitor', day + '.' + token, {
          ...options,
          expires: new Date(high),
        });
        browserReady = true;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return {
      category: req.user ? 'authenticated' : 'anonymous',
      userId: req.user?.id ?? null,
      browserReady,
    };
  }

  private async browser(
    req: Request,
    now: Date,
    db: Prisma.TransactionClient | PrismaService = this.db,
    lock = false,
  ) {
    const value = req.cookies?.cronox_daily_visitor;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}\.[a-f0-9]{64}$/.test(value) ||
      value.slice(0, 10) !== madridDate(now)
    )
      return null;
    const rows = await db.$queryRaw<BrowserDay[]>(
      Prisma.sql`SELECT * FROM "DailyVisitorBrowser" WHERE day = ${madridDate(now)}::date AND "proofHash" = ${this.hash(value.slice(11))} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    return rows[0] ?? null;
  }

  // Called after all successful server-verified access methods; no client identities.
  async bridge(
    req: Request,
    user: { id: number; role?: string | null },
    now = new Date(),
  ) {
    if (!hasAnalyticsConsent(req)) return;
    await this.reconcile(req, user, false, now);
  }

  async record(
    req: Request,
    path: string,
    _legacyBrowserId?: string,
    now = new Date(),
  ) {
    if (!isPublicVisitPath(path))
      throw new BadRequestException('PUBLIC_PAGE_REQUIRED');
    if (!hasAnalyticsConsent(req)) return { accepted: false };
    return this.reconcile(req, req.user, true, now);
  }

  private async reconcile(
    req: Request,
    user: VerifiedVisitorUser | undefined,
    publicVisit: boolean,
    now: Date,
  ) {
    const day = madridDate(now);
    return this.db.$transaction(async (tx) => {
      const browser = await this.browser(req, now, tx, true);
      const admin = user && ['ADMIN', 'SUPERADMIN'].includes(user.role ?? '');
      const legitimate =
        user &&
        ['USER', 'FRIEND'].includes(user.role ?? '') &&
        Number.isInteger(user.id);
      if (!browser) {
        if (!publicVisit || admin || (user && !legitimate))
          return { accepted: false };
        if (!legitimate)
          throw new BadRequestException('SERVER_BROWSER_PROOF_REQUIRED');
      }
      if (user && !admin && !legitimate) return { accepted: false };
      if (publicVisit && browser)
        await tx.$executeRaw`UPDATE "DailyVisitorBrowser" SET visited = true WHERE id = ${browser.id}`;
      if (browser && (admin || legitimate)) {
        await tx.$executeRaw`UPDATE "DailyVisitorBrowser" SET linked = linked OR ${Boolean(legitimate)}, "adminExcluded" = "adminExcluded" OR ${Boolean(admin)} WHERE id = ${browser.id}`;
        await tx.$executeRaw`UPDATE "DailyVisitor" SET disposition = ${admin ? 'adminExcluded' : 'linked'} WHERE day = ${day}::date AND category = 'anonymous' AND identity = ${this.hash('browser-proof:' + browser.id)}`;
      }
      if (admin || (!publicVisit && !browser?.visited))
        return { accepted: false, day };
      if (!user && (browser!.linked || browser!.adminExcluded))
        return { accepted: true, day, suppressed: true };
      const category = legitimate ? 'authenticated' : 'anonymous';
      const identity = this.hash(
        legitimate ? 'account:' + user.id : 'browser-proof:' + browser!.id,
      );
      const rows = await tx.$queryRaw<{ id: string; inserted: boolean }[]>`
        INSERT INTO "DailyVisitor" (id, day, category, identity, "userId", "firstAt", "lastAt", "observedRole")
        VALUES (${randomUUID()}, ${day}::date, ${category}, ${identity}, ${legitimate ? user.id : null}, ${now}, ${now}, ${legitimate ? user.role : null})
        ON CONFLICT (day, category, identity) DO UPDATE SET "firstAt" = LEAST("DailyVisitor"."firstAt", EXCLUDED."firstAt"), "lastAt" = GREATEST("DailyVisitor"."lastAt", EXCLUDED."lastAt") RETURNING id, (xmax = 0) AS inserted
      `;
      if (legitimate && browser)
        await tx.$executeRaw`INSERT INTO "DailyVisitorLink" ("browserId", "visitorId") VALUES (${browser.id}, ${rows[0].id}) ON CONFLICT DO NOTHING`;
      // Notify only the original public visit, never login reconciliation or a
      // second authenticated identity for an already visited browser-day.
      if (
        rows[0].inserted &&
        publicVisit &&
        !isAutomatedPushVisit(req) &&
        (!legitimate || !browser?.visited)
      ) {
        await tx.$executeRawUnsafe('SAVEPOINT admin_push_visit');
        try {
          await tx.$queryRaw`SELECT cronox_enqueue_admin_push('visits', ${rows[0].id}, jsonb_build_object('visitorId', ${rows[0].id}), ${now}::timestamptz)`;
        } catch {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT admin_push_visit');
        }
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT admin_push_visit');
      }
      return { accepted: true, day, category };
    });
  }

  async report(from: string, to: string) {
    validateRange(from, to);
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365)
      throw new BadRequestException(
        'Consulta como máximo 366 días por intervalo.',
      );
    if (to > madridDate(new Date()))
      throw new BadRequestException('No se pueden consultar días futuros.');
    return this.db.$transaction(
      async (tx) => {
        const [meta] = await tx.$queryRaw<
          { startedAt: Date; deduplicationStartedAt: Date | null }[]
        >`SELECT "startedAt", "deduplicationStartedAt" FROM "VisitorHistoryConfig" WHERE "id" = 1`;
        const rows = await tx.$queryRaw<
          { day: string; category: string; count: bigint }[]
        >`
        SELECT "day"::text AS day, "category", COUNT(*) AS count FROM "CountedDailyVisitor"
        WHERE "day" BETWEEN ${from}::date AND ${to}::date GROUP BY "day", "category" ORDER BY "day"
      `;
        const counts = new Map(
          rows.map((row) => [`${row.day}:${row.category}`, Number(row.count)]),
        );
        const startedDay = madridDate(meta.startedAt);
        const buckets: {
          day: string;
          authenticated: number | null;
          anonymous: number | null;
        }[] = [];
        for (let day = from; day <= to; day = nextDate(day))
          buckets.push({
            day,
            authenticated:
              day < startedDay
                ? null
                : (counts.get(`${day}:authenticated`) ?? 0),
            anonymous:
              day < startedDay ? null : (counts.get(`${day}:anonymous`) ?? 0),
          });
        return {
          deduplicationStartedAt: meta.deduplicationStartedAt,
          startedAt: meta.startedAt,
          startedDay,
          timeZone: 'Europe/Madrid',
          buckets,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async detail(day: string, category: string, search: string, page: number) {
    validateRange(day, day);
    if (day > madridDate(new Date()))
      throw new BadRequestException('No se pueden consultar días futuros.');
    const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const filter = Prisma.sql`v."day" = ${day}::date
      AND (${category} = 'all' OR v."category" = ${category})
      AND (${search} = '' OR v."id" ILIKE ${term} OR v."userId"::text = ${search}
        OR u."name" ILIKE ${term} OR u."email" ILIKE ${term} OR u."memberCode" ILIKE ${term})`;
    return this.db.$transaction(
      async (tx) => {
        const totals = await tx.$queryRaw<
          { category: string; count: bigint }[]
        >`
        SELECT "category", COUNT(*) AS count FROM "CountedDailyVisitor" WHERE "day" = ${day}::date GROUP BY "category"
      `;
        const [count] = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM "CountedDailyVisitor" v LEFT JOIN "User" u ON u.id = v."userId" WHERE ${filter}
      `;
        const total = Number(count.count),
          pageSize = 25,
          pages = Math.max(1, Math.ceil(total / pageSize));
        page = Math.min(page, pages);
        const visitors = await tx.$queryRaw`
        SELECT v."id", v."category", v."userId", u."name", u."email", u."memberCode", v."firstAt", v."lastAt"
        FROM "CountedDailyVisitor" v LEFT JOIN "User" u ON u.id = v."userId" WHERE ${filter}
        ORDER BY v."firstAt", v."id" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `;
        const [meta] = await tx.$queryRaw<
          { startedAt: Date; deduplicationStartedAt: Date | null }[]
        >`SELECT "startedAt", "deduplicationStartedAt" FROM "VisitorHistoryConfig" WHERE "id" = 1`;
        const available = day >= madridDate(meta.startedAt);
        return {
          day,
          available,
          totals: {
            authenticated: available
              ? Number(
                  totals.find((t) => t.category === 'authenticated')?.count ??
                    0,
                )
              : null,
            anonymous: available
              ? Number(
                  totals.find((t) => t.category === 'anonymous')?.count ?? 0,
                )
              : null,
          },
          visitors,
          pagination: { page, pageSize, pages, total },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
