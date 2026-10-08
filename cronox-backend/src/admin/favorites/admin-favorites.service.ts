import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { FavoritesQuery } from './admin-favorites.controller';

export type FavoritesReport = {
  rows: {
    id: number;
    name: string;
    slug: string;
    reference: string | null;
    isActive: boolean;
    available: boolean;
    favorites: number;
    image: { url: string; variants: unknown } | null;
  }[];
  total: number;
  summary: { favorites: number; users: number };
  page: number;
  pageSize: number;
};

export function favoritesReportSql(query: FavoritesQuery) {
  const term = query.search?.trim() || '';
  const search = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
  const direction = query.sort === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // A single statement/snapshot, current persisted relations only. The joins
  // exclude orphans even in imported legacy data; DISTINCT protects identities.
  return Prisma.sql`WITH valid AS (
    SELECT DISTINCT f."userId", f."productId" FROM "Favorite" f
    JOIN "User" u ON u.id=f."userId" JOIN "Product" p ON p.id=f."productId"
  ), counts AS (SELECT "productId", COUNT(*)::int AS favorites FROM valid GROUP BY "productId"),
  variants AS (SELECT "productId", MIN(sku) AS reference,
    BOOL_OR("isActive" AND stock>0) AS available FROM "ProductVariant" GROUP BY "productId"),
  images AS (SELECT DISTINCT ON ("productId") "productId", json_build_object('url',url,'variants',variants) AS image
    FROM "ProductImage" WHERE "isActive" AND "archivedAt" IS NULL ORDER BY "productId","isPrimary" DESC,"sortOrder",id),
  products AS (SELECT p.id,p.name,p.slug,p."isActive",v.reference,
    (p."isActive" AND COALESCE(v.available,false)) AS available,
    COALESCE(c.favorites,0) AS favorites,
    COALESCE(i.image,CASE WHEN p."imageUrl" IS NOT NULL THEN json_build_object('url',p."imageUrl",'variants',NULL) END) AS image
    FROM "Product" p LEFT JOIN counts c ON c."productId"=p.id
    LEFT JOIN variants v ON v."productId"=p.id LEFT JOIN images i ON i."productId"=p.id
    WHERE (${term}='' OR p.name ILIKE ${search} OR p.slug ILIKE ${search} OR p.id::text=${term}
      OR EXISTS (SELECT 1 FROM "ProductVariant" s WHERE s."productId"=p.id AND s.sku ILIKE ${search}))),
  paged AS (SELECT * FROM products ORDER BY favorites ${direction},id ASC LIMIT 25 OFFSET ${(query.page - 1) * 25})
  SELECT json_build_object('rows',COALESCE((SELECT json_agg(paged ORDER BY favorites ${direction},id) FROM paged),'[]'::json),
    'total',(SELECT COUNT(*)::int FROM products),'summary',json_build_object('favorites',(SELECT COUNT(*)::int FROM valid),
    'users',(SELECT COUNT(DISTINCT "userId")::int FROM valid)), 'page',${query.page},'pageSize',25) AS report`;
}

@Injectable()
export class AdminFavoritesService {
  constructor(private readonly prisma: PrismaService) {}
  async report(query: FavoritesQuery): Promise<FavoritesReport> {
    const [result] = await this.prisma.$queryRaw<{ report: FavoritesReport }[]>(
      favoritesReportSql(query),
    );
    return result.report;
  }
}
