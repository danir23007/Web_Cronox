'use strict';
// Explicit content publication. No Nest application, workers, SMTP or env edits.
const fs = require('node:fs'), path = require('node:path');
async function main() {
  const apply = process.argv.includes('--apply'), production = process.argv.includes('--production');
  if (!production) throw Error('EXPLICIT_PRODUCTION_TARGET_REQUIRED');
  const config = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const url = new URL(config.DATABASE_URL);
  if (!decodeURIComponent(url.username).includes('frqlgocxnyppzdgxxjuq') || !url.hostname.endsWith('.supabase.com')) throw Error('UNEXPECTED_PRODUCTION_PROJECT');
  Object.assign(process.env, config, { NODE_ENV: 'production', FRONTEND_URL: 'https://cronox.es', API_PUBLIC_URL: 'https://cronox.es', EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false' });
  const { PrismaClient } = require('@prisma/client');
  const { publishCartMailDesign } = require('../dist/email/managed/cart-abandoned-release');
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await publishCartMailDesign(db, apply), null, 2)); }
  finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.name || 'CONTENT_RELEASE_FAILED'); process.exitCode = 1; });
