'use strict';
// No SMTP calls: dry-run listing or explicit reviewed reactivation only.
const path = require('node:path');
async function main() {
  Object.assign(process.env, require('./start-local.cjs').loadLocalEnvironment());
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const args = process.argv.slice(2), value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  try {
    const [target] = await db.$queryRaw`SELECT current_database() AS name, host(inet_server_addr()) AS host`;
    if (!['127.0.0.1', '::1'].includes(target.host)) throw Error('LOCAL_DATABASE_REQUIRED');
    if (!args.includes('--apply')) {
      const rows = await db.emailDelivery.findMany({ where: { status: 'REVIEW_REQUIRED' }, orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, senderKey: true, errorCode: true, updatedAt: true, readyAt: true } });
      console.log(JSON.stringify({ database: target.name, mode: 'dry-run', rows,
        procedure: 'Resolve the recorded cause; explicitly choose id, exact updatedAt version and SUPERADMIN actor. Recovery validates the encrypted payload and current sender before requeuing. UNKNOWN is never reactivated.' }, null, 2));
      return;
    }
    const id = value('--id'), version = new Date(value('--version')), actorId = Number(value('--actor'));
    if (!id || !Number.isFinite(version.getTime()) || !Number.isSafeInteger(actorId) || actorId < 1) throw Error('ID_VERSION_AND_ACTOR_REQUIRED');
    require('ts-node').register({ project: path.join(__dirname, '..', 'tsconfig.json'), transpileOnly: true });
    const { MailTransportFactory } = require('../src/email/mail-transport.factory.ts');
    const result = await new MailTransportFactory(db).requeueDeferredAfterReview(id, version, actorId);
    console.log(JSON.stringify({ database: target.name, mode: 'apply', ...result, smtpSent: false }, null, 2));
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
