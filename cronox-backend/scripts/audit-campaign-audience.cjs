'use strict';
// Explicit read-only production audit. No Nest bootstrap, worker or mail calls.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const counts = (rows, key) => rows.reduce((a, row) => { a[row[key]] = (a[row[key]] || 0) + 1; return a; }, {});
async function main() {
  if (!process.argv.includes('--production')) throw Error('EXPLICIT_PRODUCTION_REQUIRED');
  const backupArg = process.argv.find(arg => arg.startsWith('--backup-dir='));
  if (!backupArg) throw Error('PRIVATE_BACKUP_DIRECTORY_REQUIRED');
  const directory = path.resolve(backupArg.slice('--backup-dir='.length));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const url = new URL(env.DATABASE_URL);
  if (!url.hostname.endsWith('.supabase.com') || !decodeURIComponent(url.username).includes('frqlgocxnyppzdgxxjuq')) throw Error('UNEXPECTED_PRODUCTION_PROJECT');
  const { PrismaClient } = require('@prisma/client');
  const { MailboxCampaignService } = require('../dist/mailbox/mailbox-campaign.service');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const data = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const familyId = 'campaign:INFO:BLACK_FRIDAY_NUMBERS_2026';
      const users = await tx.user.findMany({ select: { id: true, email: true, name: true, role: true, circleLevel: true, accountState: true, newsletterSubscribed: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } });
      const subscriptions = await tx.newsletterSubscription.findMany({ orderBy: { id: 'asc' } });
      const suppressions = await tx.mailboxSuppression.findMany({ orderBy: { email: 'asc' } });
      const preferences = await tx.auditLog.findMany({ where: { targetType: 'NEWSLETTER_PREFERENCE' }, orderBy: { id: 'desc' } });
      const drafts = await tx.mailboxDraft.findMany({ where: { familyId }, include: { mailbox: { select: { address: true } }, campaigns: { include: { _count: { select: { deliveries: true } } } } }, orderBy: { id: 'asc' } });
      const templates = await tx.managedEmailTemplate.findMany({ where: { familyId }, orderBy: { id: 'asc' } });
      const versions = await tx.emailTemplateVersion.findMany({ where: { template: { familyId } }, orderBy: { id: 'asc' } });
      const resolved = [];
      for (const draft of drafts) resolved.push(await new MailboxCampaignService(tx).resolveRecipients(draft.circles, tx));
      return { at: new Date(), users, subscriptions, suppressions, preferences, drafts, templates, versions, resolved };
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    fs.writeFileSync(path.join(directory, 'audit.private.json'), JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    const audiences = data.drafts.map((draft, index) => {
      const a = data.resolved[index];
      return { name: draft.campaignName, status: draft.status, mailbox: draft.mailbox.address, circles: draft.circles,
        beforeRoleFilter: a.recipients.filter(r => data.users.some(u => u.email.trim().toLowerCase() === r.email && ['USER', 'FRIEND'].includes(u.role))).length,
        count: a.recipients.length, totalUsers: a.totalUsers, excluded: a.excluded.length, exclusionCounts: a.exclusionCounts, byCircle: counts(a.recipients, 'circle'),
        scheduled: draft.campaigns.filter(c => !c.cancelledAt && ['SCHEDULED', 'PROCESSING'].includes(c.status)).map(c => ({ status: c.status, scheduledAt: c.scheduledAt, deliveries: c._count.deliveries })) };
    });
    const norm = value => value.trim().toLowerCase();
    const candidates = data.users.filter(u => !u.newsletterSubscribed && data.subscriptions.some(s => norm(s.email) === norm(u.email) && s.subscribedAt) && !data.suppressions.some(s => norm(s.email) === norm(u.email)) && !data.preferences.some(p => p.targetId === createHash('sha256').update(norm(u.email)).digest('hex') && p.metadata?.subscribed === false));
    const result = { readOnly: true, total: data.users.length, byRole: counts(data.users, 'role'), byCircle: counts(data.users, 'circleLevel'), byState: counts(data.users, 'accountState'), preferences: counts(data.users, 'newsletterSubscribed'), subscriptionRecords: data.subscriptions.length,
      suppressionReasons: counts(data.suppressions, 'reason'), evidenceRepairCandidates: candidates.length, correctedAccounts: 0, audiences,
      contentFingerprint: hash({ templates: data.templates, versions: data.versions }), draftFingerprint: hash(data.drafts), backupCreated: true };
    fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(result, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
