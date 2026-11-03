import { Prisma } from '@prisma/client';
/** Explicit financial corrections overlay the immutable point ledger. Original
 * entries and every revision remain available for audit; no extra revenue,
 * unit or stock movement is introduced by a cost correction. */
export async function applyPointCostRevisions<T extends { id: string; lines: Prisma.JsonValue }>(db: Pick<Prisma.TransactionClient, '$queryRaw'>, entries: T[]): Promise<T[]> {
  if (!entries.length) return entries;
  const revisions = await db.$queryRaw<Array<{ entryId: string; lineIndex: number; after: Prisma.JsonValue }>>(Prisma.sql`SELECT DISTINCT ON ("entryId","lineIndex") "entryId","lineIndex",after FROM "InventoryPointCostRevision" WHERE "entryId" IN (${Prisma.join(entries.map(e => e.id))}) ORDER BY "entryId","lineIndex",revision DESC`);
  return entries.map(entry => {
    const changes = revisions.filter(r => r.entryId === entry.id);
    if (!changes.length || !Array.isArray(entry.lines)) return entry;
    const lines = [...entry.lines]; for (const change of changes) lines[change.lineIndex] = change.after;
    return { ...entry, lines };
  });
}
