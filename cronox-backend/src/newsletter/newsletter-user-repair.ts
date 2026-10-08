import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeEmail } from '../common/email';
import { linkNewsletterUser } from './newsletter-user';

export async function auditNewsletterUsers(db: PrismaClient) {
  const columns = await db.$queryRaw<{ present: boolean }[]>`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='NewsletterSubscription' AND column_name='userId') AS present`;
  const link = columns[0]?.present ? Prisma.raw('s."userId"') : Prisma.raw('NULL::integer');
  const subscriptions = await db.$queryRaw<{ id: string; consent: boolean; matches: bigint; linked: number | null; target: number | null; optedIn: boolean | null }[]>(Prisma.sql`
    SELECT s.id, s."subscribedAt" IS NOT NULL AS consent, ${link} AS linked,
      count(u.id) AS matches, min(u.id) AS target, bool_and(u."newsletterSubscribed") AS "optedIn"
    FROM "NewsletterSubscription" s LEFT JOIN "User" u ON lower(btrim(u.email))=lower(btrim(s.email))
    GROUP BY s.id`);
  const duplicates = await db.$queryRaw<{ ids: number[] }[]>`SELECT array_agg(id ORDER BY id) AS ids FROM "User" GROUP BY lower(btrim(email)) HAVING count(*) > 1`;
  const subscriptionDuplicates = await db.$queryRaw<{ ids: string[] }[]>`SELECT array_agg(id ORDER BY id) AS ids FROM "NewsletterSubscription" GROUP BY lower(btrim(email)) HAVING count(*) > 1`;
  const codeCollisions = await db.$queryRaw<{ ids: number[] }[]>`SELECT array_agg(id ORDER BY id) AS ids FROM "User" WHERE "memberCode" IS NOT NULL GROUP BY lower(btrim("memberCode")) HAVING count(*) > 1`;
  const states = await db.$queryRaw<{ state: string; count: bigint; withoutPassword: bigint }[]>`SELECT "accountState"::text AS state, count(*) AS count, count(*) FILTER(WHERE "passwordHash" IS NULL) AS "withoutPassword" FROM "User" GROUP BY "accountState"`;
  return {
    migrated: Boolean(columns[0]?.present), totalSubscriptions: subscriptions.length,
    confirmedWithoutAccount: subscriptions.filter(s => s.consent && s.matches === 0n).map(s => s.id),
    needsLink: subscriptions.filter(s => s.consent && s.matches === 1n && (s.linked !== s.target || !s.optedIn)).map(s => s.id),
    unconfirmed: subscriptions.filter(s => !s.consent).length,
    ambiguous: subscriptions.filter(s => s.matches > 1n).map(s => s.id),
    duplicateUsers: duplicates, duplicateSubscriptions: subscriptionDuplicates, codeCollisions,
    states: states.map(row => ({ ...row, count: Number(row.count), withoutPassword: Number(row.withoutPassword) })),
  };
}

/** No email jobs, credentials, activation, deletion, merging or consent invention. */
export async function repairNewsletterUsers(db: PrismaClient, apply = false) {
  const before = await auditNewsletterUsers(db);
  if (!apply) return { mode: 'dry-run', before };
  if (!before.migrated || before.ambiguous.length || before.duplicateUsers.length || before.duplicateSubscriptions.length || before.codeCollisions.length) throw new Error('Migration or manual collision review required before repair');
  const ids = [...before.confirmedWithoutAccount, ...before.needsLink];
  for (const id of ids) {
    for (let attempt = 0; ; attempt++) {
      try {
        await db.$transaction(async tx => {
          const original = await tx.newsletterSubscription.findUnique({ where: { id } });
          if (!original) return;
          const email = normalizeEmail(original.email);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + email}))`;
          const subscription = await tx.newsletterSubscription.findUnique({ where: { id } });
          if (!subscription?.subscribedAt) return;
          const user = await linkNewsletterUser(tx, email, true);
          if (subscription.userId && subscription.userId !== user.id) throw new Error('Historical account link conflict: manual review required');
          await tx.newsletterSubscription.update({ where: { id }, data: { userId: user.id } });
        });
        break;
      } catch (error) {
        if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) continue;
        throw error;
      }
    }
  }
  return { mode: 'apply', processed: ids.length, before, after: await auditNewsletterUsers(db) };
}
