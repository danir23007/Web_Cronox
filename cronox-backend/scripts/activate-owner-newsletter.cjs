'use strict';
// One owner-requested cohort. Never wired into startup, migrations or mail jobs.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const argument = name => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
function durablePrivateFile(filename, value) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
async function main() {
  if (!process.argv.includes('--production')) throw Error('EXPLICIT_PRODUCTION_REQUIRED');
  const modes = ['--prepare', '--apply', '--rollback'].filter(flag => process.argv.includes(flag));
  if (modes.length !== 1 || !argument('--workdir')) throw Error('EXPLICIT_MODE_AND_PRIVATE_WORKDIR_REQUIRED');
  const directory = path.resolve(argument('--workdir'));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const url = new URL(env.DATABASE_URL);
  if (!url.hostname.endsWith('.supabase.com') || !decodeURIComponent(url.username).includes('frqlgocxnyppzdgxxjuq')) throw Error('UNEXPECTED_PRODUCTION_PROJECT');
  const { PrismaClient } = require('@prisma/client');
  const { preferenceKey } = require('../dist/newsletter/newsletter-preference');
  const { activateOwnerNewsletter, rollbackOwnerNewsletter, captureActivationState, activationPlanHash, validateActivationPlan } = require('../dist/newsletter/owner-newsletter-activation');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const planFile = path.join(directory, 'plan.private.json');
    if (modes[0] === '--prepare') {
      if (!argument('--initial-audit')) throw Error('INITIAL_READ_ONLY_AUDIT_REQUIRED');
      const initial = JSON.parse(fs.readFileSync(path.resolve(argument('--initial-audit')), 'utf8'));
      if (!Array.isArray(initial.users) || !initial.at) throw Error('INVALID_INITIAL_AUDIT');
      const state = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return captureActivationState(tx, initial.users.map(u => u.id));
      }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
      if (state.liveCampaigns.length) throw Error('OWNER_NEWSLETTER_SCHEDULE_REVIEW_REQUIRED');
      const cohort = initial.users.map(original => {
        const current = state.users.find(u => u.id === original.id);
        if (!current || current.createdAt.toISOString() !== original.createdAt || preferenceKey(current.email) !== preferenceKey(original.email)) throw Error('INITIAL_ACCOUNT_IDENTITY_CHANGED');
        return { id: original.id, identityUid: current.identityUid, emailKey: preferenceKey(original.email), createdAt: original.createdAt, initiallySubscribed: original.newsletterSubscribed };
      }).sort((a, b) => a.id - b.id);
      const plan = { version: 1, runId: 'owner-nl-20261126-existing-accounts', capturedAt: initial.at, cohort };
      validateActivationPlan(plan);
      durablePrivateFile(path.join(directory, 'prepared-before.private.json'), { plan, state });
      durablePrivateFile(planFile, plan);
      console.log(JSON.stringify({ mode: 'prepared', readOnly: true, runId: plan.runId, planHash: activationPlanHash(plan), cohortSize: cohort.length, initiallyFalse: cohort.filter(m => !m.initiallySubscribed).length, liveCampaigns: 0, privateBackupCreated: true }, null, 2));
      return;
    }
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const result = modes[0] === '--rollback'
      ? await rollbackOwnerNewsletter(db, plan)
      : await activateOwnerNewsletter(db, plan, state => durablePrivateFile(path.join(directory, `before-apply-${randomUUID()}.private.json`), state));
    // The immutable batch marker, not this local file, establishes idempotence.
    const summary = { mode: modes[0].slice(2), runId: plan.runId, ...result };
    if (summary.original) { summary.originalUpdated = summary.original.updated; delete summary.original; }
    durablePrivateFile(path.join(directory, `result-${randomUUID()}.json`), summary);
    console.log(JSON.stringify(summary, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.name, error.message?.startsWith('OWNER_') || error.message?.startsWith('INITIAL_') ? error.message : 'OPERATION_ABORTED'); process.exitCode = 1; });
