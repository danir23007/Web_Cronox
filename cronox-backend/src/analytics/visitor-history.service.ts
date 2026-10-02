import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { hasAnalyticsConsent } from './analytics-consent';
import { cleanPageForPath, LEGACY_PUBLIC_REDIRECTS, UNGATED_PUBLIC_PATHS } from '../common/routing/public-pages';
import { madridDate, nextDate, validateRange } from '../admin/finance/financial-calculations';

export const isPublicVisitPath = (path: string) =>
  !path.includes('?') && !path.includes('#') &&
  (Boolean(cleanPageForPath(path)) || LEGACY_PUBLIC_REDIRECTS.has(path) || UNGATED_PUBLIC_PATHS.has(path) || ['/launch.html','/producto.html'].includes(path));

@Injectable()
export class VisitorHistoryService {
  constructor(private readonly db: PrismaService) {}

  async record(req: Request, path: string, browserId: string | undefined, now = new Date()) {
    if (!isPublicVisitPath(path)) throw new BadRequestException('PUBLIC_PAGE_REQUIRED');
    if (!hasAnalyticsConsent(req)) return { accepted: false };
    const userId = req.user?.id ?? null; // Only the passport-verified identity.
    if (!userId && !browserId) throw new BadRequestException('BROWSER_ID_REQUIRED');
    const category = userId ? 'authenticated' : 'anonymous';
    // Browser UUID is never returned or stored verbatim. No IP or fingerprint.
    const identity = createHash('sha256').update(userId ? `account:${userId}` : `browser:${browserId}`).digest('hex');
    const day = madridDate(now);
    await this.db.$executeRaw`
      INSERT INTO "DailyVisitor" ("id", "day", "category", "identity", "userId", "firstAt", "lastAt")
      VALUES (${randomUUID()}, ${day}::date, ${category}, ${identity}, ${userId}, ${now}, ${now})
      ON CONFLICT ("day", "category", "identity") DO UPDATE
      SET "firstAt" = LEAST("DailyVisitor"."firstAt", EXCLUDED."firstAt"),
          "lastAt" = GREATEST("DailyVisitor"."lastAt", EXCLUDED."lastAt")
    `;
    return { accepted: true, day, category };
  }

  async report(from: string, to: string) {
    validateRange(from, to);
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new BadRequestException('Consulta como máximo 366 días por intervalo.');
    if (to > madridDate(new Date())) throw new BadRequestException('No se pueden consultar días futuros.');
    return this.db.$transaction(async tx => {
      const [meta] = await tx.$queryRaw<{ startedAt: Date }[]>`SELECT "startedAt" FROM "VisitorHistoryConfig" WHERE "id" = 1`;
      const rows = await tx.$queryRaw<{ day: string; category: string; count: bigint }[]>`
        SELECT "day"::text AS day, "category", COUNT(*) AS count FROM "DailyVisitor"
        WHERE "day" BETWEEN ${from}::date AND ${to}::date GROUP BY "day", "category" ORDER BY "day"
      `;
      const counts = new Map(rows.map(row => [`${row.day}:${row.category}`, Number(row.count)]));
      const startedDay = madridDate(meta.startedAt);
      const buckets: { day: string; authenticated: number | null; anonymous: number | null }[] = [];
      for (let day = from; day <= to; day = nextDate(day)) buckets.push({ day,
        authenticated: day < startedDay ? null : counts.get(`${day}:authenticated`) ?? 0,
        anonymous: day < startedDay ? null : counts.get(`${day}:anonymous`) ?? 0,
      });
      return { startedAt: meta.startedAt, startedDay, timeZone: 'Europe/Madrid', buckets };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async detail(day: string, category: string, search: string, page: number) {
    validateRange(day, day);
    if (day > madridDate(new Date())) throw new BadRequestException('No se pueden consultar días futuros.');
    const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const filter = Prisma.sql`v."day" = ${day}::date
      AND (${category} = 'all' OR v."category" = ${category})
      AND (${search} = '' OR v."id" ILIKE ${term} OR v."userId"::text = ${search}
        OR u."name" ILIKE ${term} OR u."email" ILIKE ${term})`;
    return this.db.$transaction(async tx => {
      const totals = await tx.$queryRaw<{ category: string; count: bigint }[]>`
        SELECT "category", COUNT(*) AS count FROM "DailyVisitor" WHERE "day" = ${day}::date GROUP BY "category"
      `;
      const [count] = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM "DailyVisitor" v LEFT JOIN "User" u ON u.id = v."userId" WHERE ${filter}
      `;
      const total = Number(count.count), pageSize = 25, pages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(page, pages);
      const visitors = await tx.$queryRaw`
        SELECT v."id", v."category", v."userId", u."name", u."email", v."firstAt", v."lastAt"
        FROM "DailyVisitor" v LEFT JOIN "User" u ON u.id = v."userId" WHERE ${filter}
        ORDER BY v."firstAt", v."id" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `;
      const [meta] = await tx.$queryRaw<{ startedAt: Date }[]>`SELECT "startedAt" FROM "VisitorHistoryConfig" WHERE "id" = 1`;
      const available = day >= madridDate(meta.startedAt);
      return { day, available, totals: {
        authenticated: available ? Number(totals.find(t => t.category === 'authenticated')?.count ?? 0) : null,
        anonymous: available ? Number(totals.find(t => t.category === 'anonymous')?.count ?? 0) : null,
      }, visitors, pagination: { page, pageSize, pages, total } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
