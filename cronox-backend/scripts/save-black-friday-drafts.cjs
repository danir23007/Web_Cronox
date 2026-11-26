'use strict';
// Explicit manual release only; never called by migrations, startup or deploy.
const fs = require('node:fs'), path = require('node:path');
async function main() {
  if (!process.argv.includes('--production')) throw Error('EXPLICIT_PRODUCTION_TARGET_REQUIRED');
  const config = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const url = new URL(config.DATABASE_URL);
  if (!decodeURIComponent(url.username).includes('frqlgocxnyppzdgxxjuq') || !url.hostname.endsWith('.supabase.com')) throw Error('UNEXPECTED_PRODUCTION_PROJECT');
  Object.assign(process.env, config, { NODE_ENV: 'production', FRONTEND_URL: 'https://cronox.es', API_PUBLIC_URL: 'https://cronox.es', EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false' });
  const { PrismaClient } = require('@prisma/client');
  const { saveBlackFridayDrafts } = require('../dist/email/managed/black-friday-draft-release');
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await saveBlackFridayDrafts(db, process.argv.includes('--apply')), null, 2)); }
  finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.name || 'DRAFT_RELEASE_FAILED'); process.exitCode = 1; });
