'use strict';
// Read-only inventory. No Stripe calls, mail, status changes or reconstructed events.
// The explicit database name prevents accidentally auditing another local profile.
const { PrismaClient } = require('@prisma/client');
async function main() {
  const expected = process.argv.find(arg => arg.startsWith('--database='))?.slice(11);
  if (!expected || !process.env.DATABASE_URL) throw Error('Provide DATABASE_URL and --database=<exact local database name>');
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/' + expected) throw Error('LOCAL_DATABASE_TARGET_MISMATCH');
  const prisma = new PrismaClient();
  try {
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const database = await tx.$queryRaw`SELECT current_database() AS name`;
      if (database[0].name !== expected) throw Error('DATABASE_IDENTITY_MISMATCH');
      const events = await tx.stripeWebhookEvent.findMany({ where: { status: { not: 'PROCESSED' } }, select: { id: true, type: true, paymentIntentId: true, status: true, error: true, attempts: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
      const effects = await tx.checkoutEffect.findMany({ where: { status: { not: 'COMPLETED' } }, select: { id: true, orderId: true, kind: true, status: true, error: true, result: true, attempts: true }, orderBy: { createdAt: 'asc' } });
      return { mode: 'dry-run-read-only', database: expected, events, effects };
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
