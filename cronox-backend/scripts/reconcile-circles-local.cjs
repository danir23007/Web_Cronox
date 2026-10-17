'use strict';
// Local, explicit historical repair. Default invocation is database READ ONLY.
const fs = require('node:fs');
const path = require('node:path');
const backend = path.resolve(__dirname, '..');
const isCircle = value => Number.isInteger(value) && value >= 1 && value <= 5;
const validDate = (value, now) => value && Number.isFinite(new Date(value).getTime()) && new Date(value) <= now;

function parseArgs(args) {
  const options = { apply: false, report: null, help: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') options.apply = true;
    else if (args[i] === '--help') options.help = true;
    else if (args[i] === '--report' && args[i + 1] && !args[i + 1].startsWith('--')) options.report = path.resolve(args[++i]);
    else throw new Error('Argumento no admitido. Uso: node scripts/reconcile-circles-local.cjs [--apply] [--report archivo.json]');
  }
  return options;
}

// Interpret only explicit circle evidence; unrelated profile edits are ignored.
// A bulk "changed" row proves a circle transition only if circleLevel was the
// sole requested field. Otherwise its change may have been in role/accountState.
function circleEvents(audits, userId) {
  const events = [];
  for (const audit of audits) {
    const metadata = audit.metadata || {};
    if (audit.targetType === 'users') {
      const record = Array.isArray(metadata.records) && metadata.records.find(row => row.id === userId);
      const changes = metadata.changes || {};
      if (!record || record.state !== 'changed' || changes.circleLevel === undefined) continue;
      events.push({ id: audit.id, at: audit.createdAt, from: null, to: changes.circleLevel,
        ambiguous: !isCircle(changes.circleLevel) || Object.keys(changes).some(key => key !== 'circleLevel'),
        manual: true });
      continue;
    }
    if (audit.targetType !== 'user' || audit.targetId !== String(userId)) continue;
    const from = audit.fromCircle ?? metadata.before?.circleLevel;
    const to = audit.toCircle ?? metadata.after?.circleLevel;
    if (from == null && to == null) continue;
    const conflicting = (audit.fromCircle != null && metadata.before?.circleLevel != null && audit.fromCircle !== metadata.before.circleLevel)
      || (audit.toCircle != null && metadata.after?.circleLevel != null && audit.toCircle !== metadata.after.circleLevel);
    if (!conflicting && from === to && isCircle(from)) continue;
    events.push({ id: audit.id, at: audit.createdAt, from, to,
      ambiguous: conflicting || !isCircle(from) || !isCircle(to),
      manual: /admin\./i.test(audit.actionType || audit.action || '') });
  }
  return events.sort((a, b) => new Date(a.at) - new Date(b.at) || a.id - b.id);
}

function recoverCircle2Date(audits, userId, now) {
  const events = circleEvents(audits, userId);
  const last = events.at(-1);
  if (!last) return { reason: 'promotion_date_without_evidence' };
  if (last.ambiguous || !validDate(last.at, now)) return { reason: 'promotion_date_ambiguous', evidenceAuditId: last.id };
  // Current II must correspond to the last recorded transition. A later move
  // to another circle means an unrecorded return: its date cannot be inferred.
  if (last.to !== 2 || last.from === 2) return { reason: 'promotion_date_current_cycle_unproven', evidenceAuditId: last.id };
  return { promotedAt: new Date(last.at), evidenceAuditId: last.id };
}

async function readEvidence(tx, userId) {
  return tx.auditLog.findMany({
    where: { OR: [{ targetType: 'user', targetId: String(userId) }, { targetType: 'users', actionType: 'admin.bulk.update' }] },
    select: { id: true, action: true, actionType: true, targetType: true, targetId: true, fromCircle: true, toCircle: true, metadata: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function reconcileUser(tx, userId, { apply, now, policy }) {
  // Re-read in the same serializable transaction as every possible write.
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, circleLevel: true, circle2PromotedAt: true } });
  if (!user) return { userId, outcome: 'removed_during_review' };
  const result = { userId, circleLevel: user.circleLevel };
  if (user.circleLevel > 2) return { ...result, outcome: 'higher_circle_preserved' };
  if (![1, 2].includes(user.circleLevel)) return { ...result, outcome: 'review', reason: 'invalid_circle' };
  if (user.circle2PromotedAt && !validDate(user.circle2PromotedAt, now)) {
    return { ...result, outcome: 'review', reason: 'invalid_existing_date_preserved', promotedAt: user.circle2PromotedAt };
  }
  if (user.circleLevel === 2) {
    if (user.circle2PromotedAt) return { ...result, outcome: 'existing_date_preserved', promotedAt: user.circle2PromotedAt };
    const evidence = recoverCircle2Date(await readEvidence(tx, userId), userId, now);
    if (!evidence.promotedAt) return { ...result, outcome: 'review', ...evidence };
    if (!apply) return { ...result, outcome: 'would_recover_date', ...evidence };
    const changed = await tx.user.updateMany({ where: { id: userId, circleLevel: 2, circle2PromotedAt: null }, data: { circle2PromotedAt: evidence.promotedAt } });
    if (changed.count !== 1) throw new Error(`Cambio concurrente del usuario ${userId}; vuelve a ejecutar la revisión.`);
    await tx.auditLog.create({ data: {
      action: 'membership.circle2.date_recovered', actionType: 'membership.circle2.date_recovered',
      targetType: 'user', targetId: String(userId), fromCircle: 2, toCircle: 2,
      metadata: { source: 'reconcile-circles-local', evidenceAuditId: evidence.evidenceAuditId, promotedAt: evidence.promotedAt.toISOString() },
    } });
    return { ...result, outcome: 'date_recovered', ...evidence };
  }
  const netSpendCents = await policy.getNetSpendCents(tx, userId, now);
  if (netSpendCents === null) return { ...result, outcome: 'review', reason: 'net_spend_unknown', netSpendCents };
  if (netSpendCents < policy.CIRCLE_II_THRESHOLD_CENTS) return { ...result, outcome: 'below_threshold', netSpendCents };
  if (!apply) return { ...result, outcome: 'would_promote', netSpendCents, promotedAt: user.circle2PromotedAt ?? null,
    effectiveDateSource: user.circle2PromotedAt ? 'existing_date' : 'application_transaction_time' };
  const promotion = await policy.reconcileCircle2(tx, userId, now);
  if (!promotion.changed) return { ...result, outcome: 'unchanged_after_recheck', netSpendCents: promotion.netSpendCents };
  await tx.auditLog.create({ data: {
    action: 'membership.circle2.local_reconciliation', actionType: 'membership.circle2.local_reconciliation',
    targetType: 'user', targetId: String(userId), fromCircle: 1, toCircle: 2,
    metadata: { source: 'reconcile-circles-local', thresholdCents: policy.CIRCLE_II_THRESHOLD_CENTS,
      netSpendCents: promotion.netSpendCents, promotedAt: promotion.promotedAt.toISOString(), effectiveAt: now.toISOString() },
  } });
  return { ...result, outcome: 'promoted', netSpendCents: promotion.netSpendCents, promotedAt: promotion.promotedAt };
}

async function run(options) {
  if (options.report && fs.existsSync(options.report)) throw new Error('El archivo de informe ya existe; elige una ruta nueva para conservarlo.');
  // Never accept a caller-supplied connection string or inherited production URL.
  const env = require('./start-local.cjs').loadLocalEnvironment();
  const connection = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || env.NODE_ENV !== 'development') throw new Error('Se requiere una base local de desarrollo.');
  Object.assign(process.env, env);
  require('ts-node').register({ transpileOnly: true, project: path.join(backend, 'tsconfig.json') });
  const { PrismaClient } = require('@prisma/client');
  const policy = require('../src/membership/circle-policy.ts');
  const { serializableTransaction } = require('../src/prisma/serializable-transaction.ts');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const report = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [database] = await tx.$queryRawUnsafe(`SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port, now() AS time`);
      if (!['127.0.0.1', '::1'].includes(database.host) || database.name !== decodeURIComponent(connection.pathname.slice(1))) throw new Error('La conexión no corresponde a la base local validada.');
      const [column] = await tx.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='circle2PromotedAt') AS present`);
      if (!column.present) throw new Error('Falta la migración local de circle2PromotedAt. Este script no aplica migraciones.');
      const users = await tx.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
      return { mode: options.apply ? 'apply' : 'dry-run', database: { name: database.name, host: database.host, port: database.port },
        reviewedAt: database.time, thresholdCents: policy.CIRCLE_II_THRESHOLD_CENTS, userIds: users.map(user => user.id), results: [] };
    });
    for (const userId of report.userIds) {
      const result = await serializableTransaction(db, async tx => {
        if (!options.apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const [clock] = await tx.$queryRawUnsafe('SELECT transaction_timestamp() AS now');
        return reconcileUser(tx, userId, { apply: options.apply, now: clock.now, policy });
      });
      report.results.push(result);
    }
    delete report.userIds;
    report.counts = report.results.reduce((counts, result) => {
      counts[result.outcome] = (counts[result.outcome] || 0) + 1;
      return counts;
    }, {});
    if (options.report) {
      fs.mkdirSync(path.dirname(options.report), { recursive: true });
      fs.writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    }
    return report;
  } finally { await db.$disconnect(); }
}

module.exports = { parseArgs, circleEvents, recoverCircle2Date, reconcileUser, run };
if (require.main === module) {
  Promise.resolve().then(() => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return console.log('Uso: node scripts/reconcile-circles-local.cjs [--apply] [--report archivo.json]\nSin --apply: solo lectura. Solo PostgreSQL local validado. No migra, no conecta producción ni altera acreditaciones.');
    return run(options).then(report => console.log(JSON.stringify(report, null, 2)));
  }).catch(error => {
    // Prisma errors can contain connection details; expose only known-safe text.
    console.error(error.code ? `Reconciliación interrumpida (${error.code}); revisa el entorno local.` : error.message);
    process.exitCode = 1;
  });
}
