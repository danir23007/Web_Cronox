'use strict';
// Explicit calendar alignment only. No application, SMTP, payment calls or workers.
const fs = require('node:fs'), path = require('node:path');
async function main() {
  if (!process.argv.includes('--production')) throw Error('EXPLICIT_PRODUCTION_REQUIRED');
  const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const url = new URL(env.DATABASE_URL);
  if (!url.hostname.endsWith('.supabase.com') || !decodeURIComponent(url.username).includes('frqlgocxnyppzdgxxjuq')) throw Error('UNEXPECTED_PRODUCTION_PROJECT');
  const { PrismaClient } = require('@prisma/client');
  const { BlackFridayService } = require('../dist/key-screen/black-friday');
  const { BLACK_FRIDAY_START, BLACK_FRIDAY_END, blackFridayDiscountPolicy } = require('../dist/common/black-friday-discounts');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    console.log(JSON.stringify(await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('black-friday-discount-calendar-2026'))`;
      const before = await tx.blackFridaySettings.findUniqueOrThrow({ where: { id: 'global' } });
      const changed = before.startsAt.toISOString() !== BLACK_FRIDAY_START || before.endsAt.toISOString() !== BLACK_FRIDAY_END;
      if (changed && process.argv.includes('--apply')) await new BlackFridayService(tx).save({ ...before, startsAt: BLACK_FRIDAY_START, endsAt: BLACK_FRIDAY_END }, before.updatedBy ?? undefined);
      const after = await tx.blackFridaySettings.findUniqueOrThrow({ where: { id: 'global' } });
      for (const key of ['enabled', 'title', 'bannerText', 'eventText', 'textColor', 'backgroundColor', 'updatedBy'])
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw Error('UNRELATED_BLACK_FRIDAY_SETTINGS_CHANGED');
      return { applied: process.argv.includes('--apply'), changed, previous: { startsAt: before.startsAt, endsAt: before.endsAt },
        current: { startsAt: after.startsAt, endsAt: after.endsAt, enabled: after.enabled, revision: after.revision }, policy: await blackFridayDiscountPolicy(tx), otherSettingsPreserved: true };
    }), null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.code || e.name); process.exitCode = 1; });
