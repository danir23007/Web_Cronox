'use strict';
const { loadLocalEnvironment } = require('./start-local.cjs');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: loadLocalEnvironment().DATABASE_URL } } });
const emails = process.argv.slice(2).map(value => value.trim().toLowerCase());
if (!emails.length) throw new Error('Provide the exact examples; no addresses are inferred');
(async () => {
  const results = [];
  for (let index = 0; index < emails.length; index++) {
    const email = emails[index];
    const users = await db.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, memberCode: true, accountState: true } });
    const subscriptions = await db.newsletterSubscription.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, userId: true, subscribedAt: true } });
    results.push({ example: index + 1, users, subscriptions });
  }
  console.log(JSON.stringify({ scope: 'protected local database only', results }, null, 2));
})().catch(error => { console.error(error.code || 'Local audit failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
