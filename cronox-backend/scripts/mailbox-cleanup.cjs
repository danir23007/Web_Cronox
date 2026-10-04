/* Explicit environment only. No .env loader, SMTP, HTTP server or background jobs. */
'use strict';
const path = require('node:path');
async function main() {
  const args = process.argv.slice(2), id = args.find(a => a.startsWith('--mailbox='))?.slice(10);
  if (!id || !process.env.DATABASE_URL) throw Error('Set DATABASE_URL explicitly and pass --mailbox=<exact mailbox ID>.');
  const execute = args.includes('--execute');
  if (execute && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname))
    throw Error('This delivery permits execution only against a local test database. Use simulation to review other environments.');
  const { PrismaClient } = require('@prisma/client');
  const { MailboxRetentionService } = require('../dist/mailbox/mailbox-retention.service');
  const { MailboxFilesService } = require('../dist/mailbox/mailbox-files.service');
  const { MailboxLeasesService } = require('../dist/mailbox/mailbox-leases.service');
  const { MailboxProviderService } = require('../dist/mailbox/mailbox-provider.service');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const provider = new MailboxProviderService();
    // Execution from this CLI requires an explicitly supplied local fixture adapter.
    // A loopback database can still contain production mailbox credentials.
    if (execute && !process.env.MAILBOX_CLEANUP_TEST_ADAPTER) throw Error('Local execution requires MAILBOX_CLEANUP_TEST_ADAPTER. Real provider mutation is disabled in this CLI.');
    if (process.env.MAILBOX_CLEANUP_TEST_ADAPTER) provider.imap = require(path.resolve(process.env.MAILBOX_CLEANUP_TEST_ADAPTER));
    const service = new MailboxRetentionService(db, new MailboxFilesService(), provider, new MailboxLeasesService(db));
    const after = args.find(a => a.startsWith('--after-uid='))?.slice(12);
    if (after !== undefined && (!Number.isSafeInteger(Number(after)) || Number(after) < 0)) throw Error('Invalid UID cursor');
    const report = await service.cleanBox(id, !execute, new Date(), after === undefined ? undefined : Number(after));
    if (execute) await service.garbage();
    console.log(JSON.stringify(report, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
